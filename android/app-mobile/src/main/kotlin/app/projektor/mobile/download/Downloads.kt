package app.projektor.mobile.download

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.StatFs
import android.util.Log
import app.projektor.core.ProjektorClient
import app.projektor.core.api.models.ItemDetail
import app.projektor.core.api.models.MediaFile
import app.projektor.core.items.ItemsRepository
import app.projektor.player.MIME_SSA
import app.projektor.player.MIME_VTT
import app.projektor.player.MediaSpec
import app.projektor.player.SubtitleSpec
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
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.json.JSONArray

enum class DownloadState { QUEUED, DOWNLOADING, WAITING, DONE, FAILED }

/** A subtitle saved next to the video: the server's WebVTT copy, or the original script for ASS. */
@Serializable
data class LocalSubtitle(val id: String, val fileName: String, val language: String?, val label: String, val ass: Boolean)

/**
 * One movie or episode kept on the phone: the original file byte for byte, its subtitles, fonts
 * and artwork, and the item as the server described it, so it can be shown and played offline.
 */
@Serializable
data class Download(
    val itemId: String,
    val detail: ItemDetail,
    val file: MediaFile,
    val managerId: Long = -1,
    val state: DownloadState = DownloadState.QUEUED,
    val bytes: Long = 0,
    val subtitles: List<LocalSubtitle> = emptyList(),
    val hasFonts: Boolean = false,
    val image: String? = null,
    val positionMs: Long = 0,
    val addedAt: Long = System.currentTimeMillis(),
) {
    val total: Long get() = file.sizeBytes
    val progress: Float get() = if (state == DownloadState.DONE) 1f else (bytes.toFloat() / total.coerceAtLeast(1)).coerceIn(0f, 1f)
    val isActive: Boolean get() = state == DownloadState.QUEUED || state == DownloadState.DOWNLOADING || state == DownloadState.WAITING
    val isEpisode: Boolean get() = detail.kind.value == "episode"
    /** Shows group by title; the item model carries no show id. */
    val showKey: String? get() = detail.showTitle?.takeIf { isEpisode }
}

/**
 * Downloads for offline viewing, Netflix style: kept in the app's own storage (no permission, gone
 * with the app), listed in the Downloads tab, played by the app's player without the server.
 * The system DownloadManager moves the bytes, so a download survives the app being closed and
 * resumes after a dropped connection; this store remembers what each one is and polls its progress.
 */
class DownloadStore(context: Context) {
    private val app = context.applicationContext
    private val manager = app.getSystemService(DownloadManager::class.java)
    private val json = Json { ignoreUnknownKeys = true }
    private val index = File(app.filesDir, "downloads.json")
    private val lock = Any()
    // One worker: a delete and a fresh download of the same item never touch its folder at once.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))
    // Progress has its own, so a season's worth of subtitles coming down never freezes the rings.
    private val pollScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var poller: Job? = null
    private val _downloads = MutableStateFlow(load())
    val downloads: StateFlow<List<Download>> = _downloads

    init { ensurePolling() }

    fun get(itemId: String): Download? = _downloads.value.firstOrNull { it.itemId == itemId }

    /** The finished download of this file, if there is one: the player uses it instead of the server. */
    fun playable(fileId: String): Download? = _downloads.value.firstOrNull { it.file.id == fileId && it.state == DownloadState.DONE && videoFile(it).exists() }

    /** The next downloaded episode of the same show, for Up next while offline. */
    fun nextAfter(d: Download): Download? = _downloads.value
        .filter { it.showKey != null && it.showKey == d.showKey && it.state == DownloadState.DONE && episodeOrder.compare(it, d) > 0 }
        .minWithOrNull(episodeOrder)

    /** Starts downloading [file] of [detail]. Replaces an earlier download of the same item. */
    fun start(client: ProjektorClient, detail: ItemDetail, file: MediaFile) {
        val old = get(detail.id)
        val entry = Download(itemId = detail.id, detail = detail.copy(children = emptyList()), file = file)
        update { list -> list.filterNot { it.itemId == detail.id } + entry }
        scope.launch {
            old?.let(::discard)
            fetch(client, entry)
        }
    }

    /** Fetches each episode's details and downloads the first version of each, skipping ones already here. */
    suspend fun startAll(items: ItemsRepository, client: ProjektorClient, episodeIds: List<String>): Int {
        var queued = 0
        episodeIds.filter { get(it) == null }.forEach { id ->
            val d = items.detail(id)
            d.files.firstOrNull()?.let { start(client, d, it); queued++ }
        }
        return queued
    }

    fun retry(client: ProjektorClient, d: Download) = start(client, d.detail, d.file)

    /** Cancels a download in progress, or deletes a finished one, with everything saved for it. */
    fun remove(d: Download) {
        update { list -> list.filterNot { it.itemId == d.itemId } }
        scope.launch { discard(d) }
    }

    private fun discard(d: Download) {
        if (d.managerId >= 0) runCatching { manager.remove(d.managerId) }
        dirFor(d.itemId)?.deleteRecursively()
    }

    /** Called by the player every few seconds; the index is written off the main thread. */
    fun savePosition(itemId: String, positionMs: Long) {
        if (get(itemId) == null) return
        pollScope.launch { set(itemId) { it.copy(positionMs = positionMs) } }
    }

    /** What the player plays for a finished download: the local file and its saved subtitles. */
    fun mediaSpec(d: Download): MediaSpec {
        val dir = dirFor(d.itemId)
        val fonts = dir?.let { File(it, FONTS) }?.takeIf { d.hasFonts && it.isDirectory }?.let { Uri.fromFile(it).toString() }
        val subtitles = d.subtitles.mapNotNull { s ->
            val f = dir?.let { File(it, s.fileName) }?.takeIf { it.exists() } ?: return@mapNotNull null
            SubtitleSpec(s.id, Uri.fromFile(f).toString(), s.language, s.label, if (s.ass) MIME_SSA else MIME_VTT, fonts.takeIf { s.ass })
        }
        return MediaSpec(Uri.fromFile(videoFile(d)).toString(), null, subtitles)
    }

    /** The saved artwork as a URL Coil loads, or null. */
    fun imageOf(d: Download): String? = d.image?.let { name -> dirFor(d.itemId)?.let { File(it, name) }?.takeIf { it.exists() }?.let { Uri.fromFile(it).toString() } }

    /** Bytes used by downloads and bytes still free where they are kept. */
    fun storage(): Pair<Long, Long> {
        val used = _downloads.value.sumOf { if (it.state == DownloadState.DONE) it.total else it.bytes }
        val free = root()?.let { runCatching { StatFs(it.path).availableBytes }.getOrNull() } ?: 0L
        return used to free
    }

    // Subtitles, fonts and artwork first (small, and only reachable while online), then the video.
    private suspend fun fetch(client: ProjektorClient, entry: Download) {
        val dir = dirFor(entry.itemId)?.apply { mkdirs() }
        if (dir == null) { set(entry.itemId) { it.copy(state = DownloadState.FAILED) }; return }
        val subtitles = entry.file.subtitles.mapNotNull { s ->
            val ass = s.assUrl != null
            val name = "sub-${safeName(s.id)}.${if (ass) "ass" else "vtt"}"
            runCatching { save(client.withAccessToken(s.assUrl ?: s.url), File(dir, name)) }
                .onFailure { Log.w(TAG, "subtitle ${s.id}", it) }
                .getOrNull()?.let { LocalSubtitle(s.id, name, s.language, s.title ?: s.language ?: s.format, ass) }
        }
        val hasFonts = entry.file.subtitles.mapNotNull { it.fontsUrl }.distinct().map { fetchFonts(client, it, File(dir, FONTS)) }.any { it }
        val width = if (entry.isEpisode) 780 else 300
        val image = client.imageUrl(entry.detail.posterKey, width)?.let { url -> runCatching { save(url, File(dir, IMAGE)); IMAGE }.getOrNull() }
        if (get(entry.itemId)?.addedAt != entry.addedAt) return // Cancelled while the extras came down.
        val request = DownloadManager.Request(Uri.parse(client.withAccessToken("/api/files/${entry.file.id}/stream")))
            .setTitle(downloadTitle(entry.detail))
            .setDescription(entry.file.fileName)
            // Progress only: a finished system notification opens the file in another app.
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .apply { @Suppress("DEPRECATION") setVisibleInDownloadsUi(false) }
            .setDestinationInExternalFilesDir(app, null, "$ROOT/${safeName(entry.itemId)}/${videoName(entry.file)}")
        val id = runCatching { manager.enqueue(request) }.onFailure { Log.w(TAG, "enqueue", it) }.getOrNull()
        if (get(entry.itemId)?.addedAt != entry.addedAt) { id?.let { manager.remove(it) }; return }
        set(entry.itemId) { it.copy(managerId = id ?: -1, state = if (id == null) DownloadState.FAILED else DownloadState.QUEUED, subtitles = subtitles, hasFonts = hasFonts, image = image) }
        ensurePolling()
    }

    /** Saves the fonts the server lists for a subtitle; true when at least one arrived. */
    private fun fetchFonts(client: ProjektorClient, listPath: String, dir: File): Boolean {
        val list = runCatching { JSONArray(String(httpGet(client.withAccessToken(listPath)), Charsets.UTF_8)) }.getOrNull() ?: return false
        dir.mkdirs()
        return (0 until list.length()).count { i ->
            val font = list.getJSONObject(i)
            runCatching { save(client.withAccessToken(font.getString("url")), File(dir, safeName(font.getString("name")))) }.isSuccess
        } > 0
    }

    // While anything is in flight, read DownloadManager's progress every second.
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
        val rows = mutableMapOf<Long, Pair<DownloadState, Long>>()
        runCatching {
            manager.query(DownloadManager.Query().setFilterById(*active.map { it.managerId }.toLongArray()))?.use { c ->
                val idCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_ID)
                val statusCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)
                val bytesCol = c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
                while (c.moveToNext()) {
                    val state = when (c.getInt(statusCol)) {
                        DownloadManager.STATUS_SUCCESSFUL -> DownloadState.DONE
                        DownloadManager.STATUS_FAILED -> DownloadState.FAILED
                        DownloadManager.STATUS_PAUSED -> DownloadState.WAITING
                        DownloadManager.STATUS_RUNNING -> DownloadState.DOWNLOADING
                        else -> DownloadState.QUEUED
                    }
                    rows[c.getLong(idCol)] = state to c.getLong(bytesCol)
                }
            }
        }.onFailure { Log.w(TAG, "poll", it); return }
        val activeIds = active.map { it.itemId }.toSet()
        update { list ->
            list.map { d ->
                if (d.itemId !in activeIds || !d.isActive || d.managerId < 0) return@map d
                // A row the system dropped (cleared from its Downloads app) counts as failed.
                val (state, bytes) = rows[d.managerId] ?: (DownloadState.FAILED to d.bytes)
                d.copy(state = state, bytes = bytes.coerceAtLeast(0))
            }
        }
        // Finished since the last look: say so. A download that finished with the app closed is
        // announced the next time it opens.
        _downloads.value.filter { it.itemId in activeIds && !it.isActive }.forEach { DownloadNotifications.finished(app, it) }
    }

    private fun set(itemId: String, change: (Download) -> Download) = update { list -> list.map { if (it.itemId == itemId) change(it) else it } }

    private fun update(change: (List<Download>) -> List<Download>) {
        synchronized(lock) {
            _downloads.update(change)
            runCatching {
                val tmp = File(index.path + ".tmp")
                tmp.writeText(json.encodeToString(_downloads.value))
                tmp.renameTo(index)
            }.onFailure { Log.w(TAG, "save index", it) }
        }
    }

    // An entry the app was closed on before its video was queued can never finish: offer a retry.
    private fun load(): List<Download> =
        runCatching { json.decodeFromString<List<Download>>(index.readText()) }.getOrDefault(emptyList())
            .map { if (it.isActive && it.managerId < 0) it.copy(state = DownloadState.FAILED) else it }

    private fun root(): File? = app.getExternalFilesDir(null)?.let { File(it, ROOT) }
    private fun dirFor(itemId: String): File? = root()?.let { File(it, safeName(itemId)) }
    private fun videoFile(d: Download): File = File(dirFor(d.itemId) ?: File(app.filesDir, "missing"), videoName(d.file))
    private fun videoName(f: MediaFile): String = "video-" + safeName(f.fileName)

    private companion object {
        const val TAG = "Downloads"
        const val ROOT = "downloads"
        const val FONTS = "fonts"
        const val IMAGE = "image.jpg"
        val episodeOrder = compareBy<Download>({ it.detail.seasonNumber ?: Long.MAX_VALUE }, { it.detail.episodeNumber ?: Long.MAX_VALUE })
    }
}

/** "Show · S1 E2 · Title" for an episode, the title alone for a movie. */
fun downloadTitle(d: ItemDetail): String {
    val number = listOfNotNull(d.seasonNumber?.let { "S$it" }, d.episodeNumber?.let { "E$it" }).joinToString(" ").ifBlank { null }
    return listOfNotNull(d.showTitle, number, d.title).joinToString(" · ")
}

/** Strips characters FAT and Android's media provider refuse in a path segment. */
internal fun safeName(name: String): String = name.replace(Regex("""[\\/:*?"<>|\u0000-\u001f]"""), "_").trim().trimStart('.').ifBlank { "download" }

private fun save(url: String, to: File) {
    val tmp = File(to.path + ".part")
    tmp.writeBytes(httpGet(url))
    if (!tmp.renameTo(to)) error("could not save ${to.name}")
}

private fun httpGet(url: String): ByteArray {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = 10_000
    connection.readTimeout = 60_000
    try {
        if (connection.responseCode !in 200..299) error("HTTP ${connection.responseCode}")
        return connection.inputStream.use { it.readBytes() }
    } finally {
        connection.disconnect()
    }
}
