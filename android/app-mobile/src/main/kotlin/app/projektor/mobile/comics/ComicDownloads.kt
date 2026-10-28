package app.projektor.mobile.comics

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.util.Log
import app.projektor.core.api.models.ComicBook
import app.projektor.core.api.models.ComicFormat
import app.projektor.core.comics.BookOrderKey
import app.projektor.core.comics.ComicsRepository
import app.projektor.core.comics.bookOrder
import app.projektor.mobile.download.DownloadNotifications
import app.projektor.mobile.download.DownloadState
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/** A comic kept on the phone: the book as the server described it, its file, and its cover. */
@Serializable
data class ComicDownload(
    val bookId: String,
    val book: ComicBook,
    val managerId: Long = -1,
    val state: DownloadState = DownloadState.QUEUED,
    val bytes: Long = 0,
    val total: Long = 0,
    val hasCover: Boolean = false,
    val addedAt: Long = System.currentTimeMillis(),
) {
    val isPdf: Boolean get() = book.format == ComicFormat.PDF
    val isActive: Boolean get() = state == DownloadState.QUEUED || state == DownloadState.DOWNLOADING || state == DownloadState.WAITING
    val progress: Float get() = if (state == DownloadState.DONE) 1f else (bytes.toFloat() / total.coerceAtLeast(1)).coerceIn(0f, 1f)
    val orderKey: BookOrderKey get() = BookOrderKey(book.volume, book.chapter, book.special, book.fileName)
}

/**
 * Comics for reading offline, kept in the app's own storage beside the video downloads. Archives
 * arrive as a CBZ of the original pages in reading order, PDFs as they are; the reader opens both
 * without the server.
 */
class ComicDownloadStore(context: Context) {
    private val app = context.applicationContext
    private val manager = app.getSystemService(DownloadManager::class.java)
    private val json = Json { ignoreUnknownKeys = true }
    private val serializer = ListSerializer(ComicDownload.serializer())
    private val index = File(app.filesDir, "comic-downloads.json")
    private val lock = Any()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))
    private val pollScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var poller: Job? = null
    private val _downloads = MutableStateFlow(load())
    val downloads: StateFlow<List<ComicDownload>> = _downloads

    init { ensurePolling() }

    fun get(bookId: String): ComicDownload? = _downloads.value.firstOrNull { it.bookId == bookId }

    /** The finished download of a book, if its file is on the phone. */
    fun readable(bookId: String): ComicDownload? = get(bookId)?.takeIf { it.state == DownloadState.DONE && fileOf(it).exists() }

    fun fileOf(d: ComicDownload): File = File(dirFor(d.bookId) ?: File(app.filesDir, "missing"), if (d.isPdf) BOOK_PDF else BOOK_CBZ)

    fun coverOf(d: ComicDownload): String? =
        dirFor(d.bookId)?.let { File(it, COVER) }?.takeIf { d.hasCover && it.exists() }?.let { Uri.fromFile(it).toString() }

    /** The downloaded books of a series in reading order, for next and previous offline. */
    fun ofSeries(seriesId: String): List<ComicDownload> =
        _downloads.value.filter { it.book.seriesId == seriesId && it.state == DownloadState.DONE }.sortedWith(compareBy(bookOrder) { it.orderKey })

    fun start(repo: ComicsRepository, book: ComicBook) {
        if (get(book.id) != null) return
        val entry = ComicDownload(bookId = book.id, book = book, total = book.sizeBytes)
        update { list -> list + entry }
        scope.launch { fetch(repo, entry) }
    }

    fun remove(d: ComicDownload) {
        update { list -> list.filterNot { it.bookId == d.bookId } }
        scope.launch {
            if (d.managerId >= 0) runCatching { manager.remove(d.managerId) }
            dirFor(d.bookId)?.deleteRecursively()
        }
    }

    fun retry(repo: ComicsRepository, d: ComicDownload) {
        remove(d)
        scope.launch { start(repo, d.book) }
    }

    private fun fetch(repo: ComicsRepository, entry: ComicDownload) {
        val dir = dirFor(entry.bookId)?.apply { mkdirs() }
        if (dir == null) {
            set(entry.bookId) { it.copy(state = DownloadState.FAILED) }
            return
        }
        val hasCover = repo.coverUrl(entry.book.coverKey, 300)?.let { url ->
            runCatching {
                val connection = URL(url).openConnection() as HttpURLConnection
                try {
                    connection.connectTimeout = 10_000
                    connection.readTimeout = 30_000
                    File(dir, COVER).writeBytes(connection.inputStream.use { it.readBytes() })
                } finally {
                    connection.disconnect()
                }
            }.isSuccess
        } ?: false
        if (get(entry.bookId)?.addedAt != entry.addedAt) return
        val name = if (entry.isPdf) BOOK_PDF else BOOK_CBZ
        val request = DownloadManager.Request(Uri.parse(repo.fileUrl(entry.bookId)))
            .setTitle(listOfNotNull(entry.book.seriesTitle, entry.book.label).joinToString(" · "))
            .setDescription(entry.book.title)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationInExternalFilesDir(app, null, "$ROOT/${entry.bookId}/$name")
            .apply { @Suppress("DEPRECATION") setVisibleInDownloadsUi(false) }
        val id = runCatching { manager.enqueue(request) }.onFailure { Log.w(TAG, "enqueue", it) }.getOrNull()
        if (get(entry.bookId)?.addedAt != entry.addedAt) {
            id?.let { manager.remove(it) }
            return
        }
        set(entry.bookId) { it.copy(managerId = id ?: -1, state = if (id == null) DownloadState.FAILED else DownloadState.QUEUED, hasCover = hasCover) }
        ensurePolling()
    }

    private fun ensurePolling() {
        synchronized(lock) {
            if (poller?.isActive == true || _downloads.value.none { it.isActive }) return
            poller = pollScope.launch {
                while (isActive) {
                    poll()
                    if (_downloads.value.none { it.isActive }) break
                    delay(1_000)
                }
            }
        }
    }

    private fun poll() {
        val active = _downloads.value.filter { it.isActive && it.managerId >= 0 }
        if (active.isEmpty()) return
        val rows = mutableMapOf<Long, Triple<DownloadState, Long, Long>>()
        runCatching {
            manager.query(DownloadManager.Query().setFilterById(*active.map { it.managerId }.toLongArray()))?.use { c ->
                val idCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_ID)
                val statusCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)
                val bytesCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
                val totalCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
                while (c.moveToNext()) {
                    val state = when (c.getInt(statusCol)) {
                        DownloadManager.STATUS_SUCCESSFUL -> DownloadState.DONE
                        DownloadManager.STATUS_FAILED -> DownloadState.FAILED
                        DownloadManager.STATUS_PAUSED -> DownloadState.WAITING
                        DownloadManager.STATUS_RUNNING -> DownloadState.DOWNLOADING
                        else -> DownloadState.QUEUED
                    }
                    rows[c.getLong(idCol)] = Triple(state, c.getLong(bytesCol), c.getLong(totalCol))
                }
            }
        }.onFailure { Log.w(TAG, "poll", it); return }
        val activeIds = active.map { it.bookId }.toSet()
        update { list ->
            list.map { d ->
                if (d.bookId !in activeIds || !d.isActive || d.managerId < 0) return@map d
                val (state, bytes, total) = rows[d.managerId] ?: Triple(DownloadState.FAILED, d.bytes, d.total)
                // The CBZ is packed on the fly, so its size is the server's word, not the file's.
                d.copy(state = state, bytes = bytes.coerceAtLeast(0), total = if (total > 0) total else d.total)
            }
        }
        _downloads.value.filter { it.bookId in activeIds && !it.isActive }.forEach {
            DownloadNotifications.finished(app, it.bookId, it.state == DownloadState.DONE, listOfNotNull(it.book.seriesTitle, it.book.label ?: it.book.title).joinToString(" · "))
        }
    }

    private fun set(bookId: String, change: (ComicDownload) -> ComicDownload) = update { list -> list.map { if (it.bookId == bookId) change(it) else it } }

    private fun update(change: (List<ComicDownload>) -> List<ComicDownload>) {
        synchronized(lock) {
            _downloads.update(change)
            runCatching {
                val tmp = File(index.path + ".tmp")
                tmp.writeText(json.encodeToString(serializer, _downloads.value))
                tmp.renameTo(index)
            }.onFailure { Log.w(TAG, "save index", it) }
        }
    }

    // An entry the app was closed on before its file was queued can never finish: offer a retry.
    private fun load(): List<ComicDownload> =
        runCatching { json.decodeFromString(serializer, index.readText()) }.getOrDefault(emptyList())
            .map { if (it.isActive && it.managerId < 0) it.copy(state = DownloadState.FAILED) else it }

    private fun dirFor(bookId: String): File? = app.getExternalFilesDir(null)?.let { File(File(it, ROOT), bookId) }

    private companion object {
        const val TAG = "ComicDownloads"
        const val ROOT = "comics"
        const val BOOK_CBZ = "book.cbz"
        const val BOOK_PDF = "book.pdf"
        const val COVER = "cover.jpg"
    }
}
