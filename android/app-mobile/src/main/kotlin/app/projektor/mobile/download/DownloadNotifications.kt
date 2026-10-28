package app.projektor.mobile.download

import android.Manifest
import android.annotation.SuppressLint
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

/** Intent extra: open the app on its Downloads tab. */
const val EXTRA_OPEN_DOWNLOADS = "openDownloads"

/**
 * The app's own "Downloaded" and "Download failed" notifications. DownloadManager's own one is kept
 * to progress only: tapping a finished one would hand the file to some other video app, while
 * these open Projektor's Downloads tab, where it plays in the app's player.
 */
internal object DownloadNotifications {
    private const val CHANNEL = "downloads"

    fun finished(context: Context, d: Download) {
        val ok = d.state == DownloadState.DONE
        notify(context, d.itemId.hashCode(), if (ok) "Downloaded" else "Download failed", downloadTitle(d.detail))
    }

    @SuppressLint("MissingPermission") // Checked in canPost.
    private fun notify(context: Context, id: Int, title: String, text: String) {
        if (!canPost(context)) return
        ensureChannel(context)
        val open = Intent(context, MainActivity::class.java)
            .putExtra(EXTRA_OPEN_DOWNLOADS, true)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val tap = PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(id, notification)
    }

    private fun canPost(context: Context): Boolean =
        (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(context).areNotificationsEnabled()

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_DEFAULT))
        }
    }
}
