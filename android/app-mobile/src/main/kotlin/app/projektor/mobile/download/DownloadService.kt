package app.projektor.mobile.download

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import app.projektor.mobile.ProjektorApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.launch

/**
 * Keeps the app running while downloads come down, with the progress notification Android asks for
 * in return. The stores move the bytes themselves; this only watches them and stops once neither
 * has anything left to fetch.
 */
class DownloadService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var watching: Job? = null
    private var lastStartId = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        lastStartId = startId
        val container = (application as ProjektorApp).container
        val notification = DownloadNotifications.progress(this, container.downloads.downloads.value, container.comicDownloads.downloads.value)
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
        runCatching { ServiceCompat.startForeground(this, DownloadNotifications.PROGRESS_ID, notification, type) }
            .onFailure { Log.w(TAG, "startForeground", it); stopSelf(startId); return START_NOT_STICKY }
        if (watching == null) {
            watching = scope.launch {
                combine(container.downloads.downloads, container.comicDownloads.downloads) { videos, comics -> videos to comics }
                    .conflate()
                    .collect { (videos, comics) ->
                        if (videos.none { it.isActive } && comics.none { it.isActive }) {
                            stop()
                        } else {
                            DownloadNotifications.showProgress(this@DownloadService, videos, comics)
                            delay(1_000)
                        }
                    }
            }
        }
        return START_NOT_STICKY
    }

    // Android 15 caps data sync services at six hours a day; what is left resumes when the app opens.
    override fun onTimeout(startId: Int, fgsType: Int) {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        scope.cancel()
        NotificationManagerCompat.from(this).cancel(DownloadNotifications.PROGRESS_ID)
        super.onDestroy()
    }

    // Only as of the latest start: one that came in since (a new download) keeps the service going.
    private fun stop() {
        if (stopSelfResult(lastStartId)) ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    }

    companion object {
        private const val TAG = "DownloadService"

        /** Starts the service; the stores call this whenever they have something to fetch. */
        fun start(context: Context) {
            runCatching { ContextCompat.startForegroundService(context, Intent(context, DownloadService::class.java)) }
                // Not allowed from the background on Android 12+; downloads still run while the app is open.
                .onFailure { Log.w(TAG, "start", it) }
        }
    }
}
