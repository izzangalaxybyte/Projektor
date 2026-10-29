package app.projektor.mobile.comics

import android.content.Context
import android.util.Log
import app.projektor.core.comics.ComicsRepository
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/** A page read on this phone, and whether the server has it yet. */
@Serializable
data class LocalProgress(val page: Int, val pageCount: Int, val at: String, val synced: Boolean)

/**
 * Reading progress kept on the phone first, then sent to the server. Pages read without a
 * connection are sent later stamped with when they were read, so the server keeps whichever is
 * newer when another device read on in the meantime.
 */
class ComicProgressStore(context: Context) {
    private val prefs = context.getSharedPreferences("projektor.comic-progress", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }
    private val serializer = MapSerializer(String.serializer(), LocalProgress.serializer())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()
    private var cache: Map<String, LocalProgress> = load()

    fun get(bookId: String): LocalProgress? = cache[bookId]

    /** Saves the page and sends it; kept for later if the server cannot be reached. */
    fun save(repo: ComicsRepository?, bookId: String, page: Int, pageCount: Int) {
        val entry = LocalProgress(page, pageCount, nowIso(), synced = false)
        scope.launch {
            lock.withLock { put(bookId, entry) }
            if (repo != null) send(repo, bookId, entry)
        }
    }

    /** Sends everything read offline. Called whenever the comics screens reach the server. */
    fun flush(repo: ComicsRepository) {
        scope.launch {
            cache.filterValues { !it.synced }.forEach { (bookId, entry) -> send(repo, bookId, entry) }
        }
    }

    private suspend fun send(repo: ComicsRepository, bookId: String, entry: LocalProgress) {
        try {
            repo.setPage(bookId, entry.page, entry.at)
            lock.withLock { if (cache[bookId] == entry) put(bookId, entry.copy(synced = true)) }
        } catch (e: Exception) {
            Log.i("ComicProgress", "kept for later: $bookId (${e.message})")
        }
    }

    private fun put(bookId: String, entry: LocalProgress) {
        cache = cache + (bookId to entry)
        prefs.edit().putString(KEY, json.encodeToString(serializer, cache)).apply()
    }

    private fun load(): Map<String, LocalProgress> =
        prefs.getString(KEY, null)?.let { runCatching { json.decodeFromString(serializer, it) }.getOrNull() } ?: emptyMap()

    private companion object {
        const val KEY = "progress"
    }
}

/** Now as the server writes timestamps (`toISOString`), so the two compare as strings. */
fun nowIso(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())
