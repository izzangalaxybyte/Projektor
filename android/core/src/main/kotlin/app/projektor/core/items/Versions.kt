package app.projektor.core.items

import app.projektor.core.api.models.MediaFile
import java.util.Locale

/**
 * One line telling versions of the same episode apart, e.g.
 * "1080p · AV1 10-bit · Audio: Japanese, English, French · 24m · 652 MB".
 */
fun describeVersion(f: MediaFile): String {
    val video = f.streams.firstOrNull { it.type.value == "video" }
    val audio = f.streams.filter { it.type.value == "audio" }
    val parts = listOfNotNull(
        video?.height?.let { h -> if (h >= 2000) "4K" else "${h}p" },
        video?.let { v -> listOfNotNull(v.codec.uppercase(), v.bitDepth?.takeIf { it > 8 }?.let { "$it-bit" }, "HDR".takeIf { v.hdr }).joinToString(" ") },
        audio.takeIf { it.isNotEmpty() }?.let { a -> "Audio: " + a.map { it.title?.takeIf { t -> t.length <= 20 } ?: languageName(it.language) ?: it.codec }.distinct().joinToString(", ") },
        formatMinutes(f.durationMs),
        formatBytes(f.sizeBytes),
    )
    return parts.joinToString(" · ")
}

/**
 * The version of the next episode most like the one being watched: the file whose name shares the
 * longest start with the current one (same release group and naming), largest on a tie.
 */
fun closestVersion(currentFileName: String?, options: List<MediaFile>): MediaFile? {
    if (currentFileName == null || options.size < 2) return options.firstOrNull()
    return options.maxWithOrNull(compareBy<MediaFile> { commonPrefix(it.fileName, currentFileName) }.thenBy { it.sizeBytes })
}

private fun commonPrefix(a: String, b: String): Int {
    var i = 0
    while (i < a.length && i < b.length && a[i].lowercaseChar() == b[i].lowercaseChar()) i++
    return i
}

private fun languageName(code: String?): String? =
    code?.takeIf { it.isNotBlank() && it != "und" }?.let { Locale.forLanguageTag(it).displayLanguage.ifBlank { it } }

private fun formatMinutes(ms: Long): String? {
    val minutes = ms / 60_000
    return when {
        minutes <= 0 -> null
        minutes >= 60 -> "${minutes / 60}h ${minutes % 60}m"
        else -> "${minutes}m"
    }
}

private fun formatBytes(bytes: Long): String =
    if (bytes >= 1L shl 30) "%.1f GB".format(Locale.US, bytes / (1L shl 30).toDouble()) else "${bytes / (1L shl 20)} MB"
