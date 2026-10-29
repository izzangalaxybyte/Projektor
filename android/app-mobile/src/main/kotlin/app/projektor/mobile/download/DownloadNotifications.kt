package app.projektor.mobile.download

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.projektor.mobile.MainActivity
import app.projektor.mobile.comics.ComicDownload
import app.projektor.mobile.ui.downloads.formatBytes

/** Intent extra: open the app on its Downloads tab. */
const val EXTRA_OPEN_DOWNLOADS = "openDownloads"

/**
 * The app's download notifications: the ongoing progress one [DownloadService] runs under, and
 * "Downloaded" or "Download failed" when one ends. All of them open Projektor's Downloads tab,
 * where a video plays in the app's player.
 */
internal object DownloadNotifications {
    private const val CHANNEL = "downloads"
    // Quiet and low: it updates every second while a download runs.
    private const val PROGRESS_CHANNEL = "download-progress"
    const val PROGRESS_ID = 1

    fun finished(context: Context, d: Download) = finished(context, d.itemId, d.state == DownloadState.DONE, downloadTitle(d.detail))

    /** Any download, by id: comics use this too. */
    fun finished(context: Context, id: String, ok: Boolean, title: String) {
        notify(context, id.hashCode(), if (ok) "Downloaded" else "Download failed", title)
    }

    /** "Downloading <title>" with a bar for the transfer under way and a count of what waits after it. */
    fun progress(context: Context, videos: List<Download>, comics: List<ComicDownload>): Notification {
        ensureChannels(context)
        val lines = videos.filter { it.isActive }.map { Line(downloadTitle(it.detail), it.state, it.bytes, it.total) } +
            comics.filter { it.isActive }.map { Line(it.title, it.state, it.bytes, it.total) }
        val current = lines.firstOrNull { it.state == DownloadState.DOWNLOADING || it.state == DownloadState.WAITING } ?: lines.firstOrNull()
        val more = (lines.size - 1).takeIf { it > 0 }?.let { "$it more queued" }
        val status = when (current?.state) {
            DownloadState.WAITING -> "Waiting for network"
            DownloadState.DOWNLOADING -> "${percent(current)}% · ${formatBytes(current.bytes)} of ${formatBytes(current.total)}"
            else -> "Starting"
        }
        val builder = NotificationCompat.Builder(context, PROGRESS_CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(current?.let { "Downloading ${it.title}" } ?: "Downloading")
            .setContentText(listOfNotNull(status, more).joinToString(" · "))
            .setContentIntent(openDownloads(context, PROGRESS_ID))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
        if (current?.state == DownloadState.DOWNLOADING && current.total > 0) builder.setProgress(100, percent(current), false)
        else builder.setProgress(0, 0, true)
        return builder.build()
    }

    @SuppressLint("MissingPermission") // Checked in canPost.
    fun showProgress(context: Context, videos: List<Download>, comics: List<ComicDownload>) {
        if (canPost(context)) NotificationManagerCompat.from(context).notify(PROGRESS_ID, progress(context, videos, comics))
    }

    private class Line(val title: String, val state: DownloadState, val bytes: Long, val total: Long)

    private fun percent(line: Line): Int = (line.bytes * 100 / line.total.coerceAtLeast(1)).toInt().coerceIn(0, 100)

    private fun openDownloads(context: Context, id: Int): PendingIntent {
        val open = Intent(context, MainActivity::class.java)
            .putExtra(EXTRA_OPEN_DOWNLOADS, true)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    @SuppressLint("MissingPermission") // Checked in canPost.
    private fun notify(context: Context, id: Int, title: String, text: String) {
        if (!canPost(context)) return
        ensureChannels(context)
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(openDownloads(context, id))
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(id, notification)
    }

    private fun canPost(context: Context): Boolean =
        (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(context).areNotificationsEnabled()

    private fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_DEFAULT))
        }
        if (manager.getNotificationChannel(PROGRESS_CHANNEL) == null) {
            manager.createNotificationChannel(NotificationChannel(PROGRESS_CHANNEL, "Download progress", NotificationManager.IMPORTANCE_LOW))
        }
    }
}
