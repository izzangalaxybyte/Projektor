package app.projektor.mobile.download

import android.os.SystemClock
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.delay
import kotlinx.coroutines.yield

/** A transfer that stopped short; [retryable] when waiting and trying again may help. */
internal class TransferException(message: String, val retryable: Boolean) : IOException(message)

/**
 * Moves a download's bytes into the app's storage. The system DownloadManager used to, but some
 * phones hold its jobs forever (stuck at "Queued", the server never asked for the file), so the app
 * does it itself while [DownloadService] keeps it alive.
 */
internal object Transfer {
    /**
     * Downloads [url] into [to], resuming a partial `.part` file with a Range request and waiting out
     * a dropped connection (calling [onWaiting]) until no progress has been made for about ten
     * minutes. [onProgress] gets the bytes so far and the total (0 when unknown), at most twice a
     * second. Returns false once [isCurrent] turns false, i.e. the download was cancelled.
     */
    suspend fun fetch(
        url: String,
        to: File,
        isCurrent: () -> Boolean,
        onProgress: (Long, Long) -> Unit,
        onWaiting: () -> Unit,
    ): Boolean {
        val part = File(to.path + ".part")
        var failures = 0
        while (true) {
            if (!isCurrent()) return false
            val before = part.length()
            try {
                return attempt(url, part, to, isCurrent, onProgress)
            } catch (e: IOException) {
                if (e is TransferException && !e.retryable) throw e
                if (!isCurrent()) return false
                failures = if (part.length() > before) 1 else failures + 1
                if (failures > MAX_FAILURES) throw e
                onWaiting()
                delay(minOf(30_000L, 2_000L shl minOf(failures, 4)))
            }
        }
    }

    private suspend fun attempt(url: String, part: File, to: File, isCurrent: () -> Boolean, onProgress: (Long, Long) -> Unit): Boolean {
        val have = part.length()
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 15_000
        connection.readTimeout = 60_000
        if (have > 0) connection.setRequestProperty("Range", "bytes=$have-")
        try {
            val code = connection.responseCode
            if (code == 416 && have > 0) {
                // Nothing left past what is here: whole if it matches the size, else start over.
                val size = connection.getHeaderField("Content-Range")?.substringAfter('/')?.toLongOrNull()
                if (size == have) return finish(part, to)
                part.delete()
                throw TransferException("HTTP 416", retryable = true)
            }
            if (code !in 200..299) throw TransferException("HTTP $code", retryable = code == 408 || code == 429 || code >= 500)
            // 206 continues the part; a plain 200 (a server that ignores ranges) starts it over.
            val start = if (code == 206) have else 0L
            val length = connection.contentLengthLong
            val total = if (length >= 0) start + length else 0L
            var bytes = start
            var shown = 0L
            onProgress(bytes, total)
            connection.inputStream.use { input ->
                FileOutputStream(part, code == 206).use { out ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        out.write(buffer, 0, n)
                        bytes += n
                        if (!isCurrent()) return false
                        val now = SystemClock.elapsedRealtime()
                        if (now - shown >= 500) {
                            shown = now
                            onProgress(bytes, total)
                        }
                        // The stores' worker is single threaded: let a cancel or delete in between.
                        yield()
                    }
                }
            }
            if (total > 0 && bytes < total) throw TransferException("connection closed early", retryable = true)
            onProgress(bytes, total)
            return finish(part, to)
        } finally {
            connection.disconnect()
        }
    }

    private fun finish(part: File, to: File): Boolean {
        if (!part.renameTo(to)) {
            to.delete()
            if (!part.renameTo(to)) throw TransferException("could not save ${to.name}", retryable = false)
        }
        return true
    }

    private const val MAX_FAILURES = 20
}
