package app.projektor.mobile.comics

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.util.Log
import app.projektor.core.api.models.ComicBook
import app.projektor.core.api.models.ComicFormat
import app.projektor.core.comics.BookOrderKey
import app.projektor.core.comics.ComicsRepository
import app.projektor.core.comics.sortedInReadingOrder
import app.projektor.mobile.download.DownloadNotifications
import app.projektor.mobile.download.DownloadService
import app.projektor.mobile.download.DownloadState
import app.projektor.mobile.download.Transfer
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.yield
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/** A comic kept on the phone: the book as the server described it, its file, and its cover. */
@Serializable
data class ComicDownload(
    val bookId: String,
    val book: ComicBook,
    /** The DownloadManager job of a download an older version queued; cancelled when the app starts. */
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
    /** "Series · Vol. 3", for notifications. */
    val title: String get() = listOfNotNull(book.seriesTitle, book.label ?: book.title).joinToString(" · ")
}

/**
 * Comics for reading offline, kept in the app's own storage beside the video downloads. Archives
 * arrive as a CBZ of the original pages in reading order, PDFs as they are; the reader opens both
 * without the server. Like the video downloads, one at a time while [DownloadService] keeps the app
 * running.
 */
class ComicDownloadStore(context: Context, private val repo: () -> ComicsRepository?) {
    private val app = context.applicationContext
    private val manager by lazy { app.getSystemService(DownloadManager::class.java) }
    private val json = Json { ignoreUnknownKeys = true }
    private val serializer = ListSerializer(ComicDownload.serializer())
    private val index = File(app.filesDir, "comic-downloads.json")
    private val lock = Any()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))
    private var pump: Job? = null
    private val _downloads = MutableStateFlow(load())
    val downloads: StateFlow<List<ComicDownload>> = _downloads

    /** Picks up downloads left unfinished when the app last closed. */
    fun resume() = ensurePumping()

    fun get(bookId: String): ComicDownload? = _downloads.value.firstOrNull { it.bookId == bookId }

    /** The finished download of a book, if its file is on the phone. */
    fun readable(bookId: String): ComicDownload? = get(bookId)?.takeIf { it.state == DownloadState.DONE && fileOf(it).exists() }

    fun fileOf(d: ComicDownload): File = File(dirFor(d.bookId) ?: File(app.filesDir, "missing"), if (d.isPdf) BOOK_PDF else BOOK_CBZ)

    fun coverOf(d: ComicDownload): String? =
        dirFor(d.bookId)?.let { File(it, COVER) }?.takeIf { d.hasCover && it.exists() }?.let { Uri.fromFile(it).toString() }

    /** The downloaded books of a series in reading order, for next and previous offline. */
    fun ofSeries(seriesId: String): List<ComicDownload> =
        _downloads.value.filter { it.book.seriesId == seriesId && it.state == DownloadState.DONE }.sortedInReadingOrder { it.orderKey }

    fun start(book: ComicBook) {
        if (get(book.id) != null) return
        val entry = ComicDownload(bookId = book.id, book = book, total = book.sizeBytes)
        update { list -> list + entry }
        ensurePumping()
    }

    fun remove(d: ComicDownload) {
        update { list -> list.filterNot { it.bookId == d.bookId } }
        scope.launch {
            if (d.managerId >= 0) runCatching { manager.remove(d.managerId) }
            dirFor(d.bookId)?.deleteRecursively()
        }
    }

    fun retry(d: ComicDownload) {
        remove(d)
        scope.launch { start(d.book) }
    }

    // One book at a time, oldest first, until none is left.
    private fun ensurePumping() {
        synchronized(lock) {
            if (_downloads.value.none { it.isActive }) return
            DownloadService.start(app)
            if (pump?.isActive == true) return
            pump = scope.launch {
                while (true) {
                    // Lets a delete queued before this one clear the folder first.
                    yield()
                    val next = synchronized(lock) { _downloads.value.firstOrNull { it.isActive } ?: run { pump = null; null } } ?: break
                    runCatching { fetch(next) }.onFailure { Log.w(TAG, "download ${next.bookId}", it) }
                    if (get(next.bookId)?.let { it.addedAt == next.addedAt && it.isActive } == true) finish(next, ok = false)
                }
            }
        }
    }

    private suspend fun fetch(entry: ComicDownload) {
        val repo = repo()
        val dir = dirFor(entry.bookId)?.apply { mkdirs() }
        if (repo == null || dir == null) return finish(entry, ok = false)
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
        val current = { get(entry.bookId)?.addedAt == entry.addedAt }
        if (!current()) return
        set(entry.bookId) { it.copy(state = DownloadState.DOWNLOADING, hasCover = hasCover) }
        val ok = Transfer.fetch(
            url = repo.fileUrl(entry.bookId),
            to = fileOf(entry),
            isCurrent = current,
            // The CBZ is packed on the fly, so its size is the server's word, not the file's.
            onProgress = { bytes, total -> progress(entry, bytes, total) },
            onWaiting = { if (current()) set(entry.bookId) { it.copy(state = DownloadState.WAITING) } },
        )
        if (ok) finish(entry, ok = true)
    }

    private fun progress(entry: ComicDownload, bytes: Long, total: Long) {
        // In memory only: the index is written when the state changes.
        _downloads.update { list ->
            list.map {
                if (it.bookId == entry.bookId && it.addedAt == entry.addedAt) {
                    it.copy(state = DownloadState.DOWNLOADING, bytes = bytes, total = if (total > 0) total else it.total)
                } else it
            }
        }
    }

    private fun finish(entry: ComicDownload, ok: Boolean) {
        if (get(entry.bookId)?.addedAt != entry.addedAt) return
        set(entry.bookId) { it.copy(state = if (ok) DownloadState.DONE else DownloadState.FAILED) }
        DownloadNotifications.finished(app, entry.bookId, ok, entry.title)
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

    // Unfinished ones start over in line; one an older version handed to DownloadManager is taken back.
    private fun load(): List<ComicDownload> =
        runCatching { json.decodeFromString(serializer, index.readText()) }.getOrDefault(emptyList())
            .map { d ->
                if (!d.isActive) return@map d
                if (d.managerId >= 0) runCatching { manager.remove(d.managerId) }
                d.copy(state = DownloadState.QUEUED, managerId = -1)
            }

    private fun dirFor(bookId: String): File? = app.getExternalFilesDir(null)?.let { File(File(it, ROOT), bookId) }

    private companion object {
        const val TAG = "ComicDownloads"
        const val ROOT = "comics"
        const val BOOK_CBZ = "book.cbz"
        const val BOOK_PDF = "book.pdf"
        const val COVER = "cover.jpg"
    }
}
