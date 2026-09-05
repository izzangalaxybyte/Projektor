package app.projektor.core.live

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Pure helpers for guide times and remote-style channel changes; unit tested without Android. */
object LiveGuide {
    /** Server timestamps are ISO 8601 UTC with milliseconds; tolerate the form without them. */
    fun parseIso(iso: String): Long {
        for (pattern in listOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")) {
            val f = SimpleDateFormat(pattern, Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC"); isLenient = false }
            runCatching { return f.parse(iso)!!.time }
        }
        return 0L
    }

    /** 0..1 through a programme at `now`. */
    fun progress(startAt: String, endAt: String, now: Long = System.currentTimeMillis()): Float {
        val start = parseIso(startAt)
        val end = parseIso(endAt)
        if (end <= start) return 0f
        return ((now - start).toFloat() / (end - start)).coerceIn(0f, 1f)
    }

    /** Local wall-clock "HH:mm". */
    fun clock(iso: String, zone: TimeZone = TimeZone.getDefault()): String =
        SimpleDateFormat("HH:mm", Locale.US).apply { timeZone = zone }.format(Date(parseIso(iso)))

    fun hasEnded(endAt: String, now: Long = System.currentTimeMillis()): Boolean = parseIso(endAt) <= now

    /** The item `step` places from the current one, wrapping at both ends. */
    fun <T> neighbour(list: List<T>, currentId: String, step: Int, id: (T) -> String): T? {
        if (list.isEmpty()) return null
        val index = list.indexOfFirst { id(it) == currentId }
        if (index == -1) return list.first()
        return list[((index + step) % list.size + list.size) % list.size]
    }

    /** The channel whose number matches the typed digits. */
    fun <T> byNumber(list: List<T>, digits: String, number: (T) -> Int?): T? {
        val n = digits.toIntOrNull() ?: return null
        return list.firstOrNull { number(it) == n }
    }

    /** Whether a past programme can still be played from the channel's archive. */
    fun inArchive(startAt: String, hasArchive: Boolean, archiveDays: Int, now: Long = System.currentTimeMillis()): Boolean =
        hasArchive && parseIso(startAt) >= now - archiveDays * 86_400_000L

    const val NUMBER_ENTRY_COMMIT_MS = 1_500L
}
