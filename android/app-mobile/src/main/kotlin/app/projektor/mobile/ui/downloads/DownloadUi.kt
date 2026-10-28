package app.projektor.mobile.ui.downloads

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.OfflinePin
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.projektor.mobile.download.Download
import app.projektor.mobile.download.DownloadState
import java.util.Locale

fun formatBytes(bytes: Long): String =
    if (bytes >= 1L shl 30) "%.1f GB".format(Locale.US, bytes / (1L shl 30).toDouble()) else "${bytes / (1L shl 20)} MB"

/** "Queued", "42% · 512 MB of 1.2 GB", "1.2 GB", ... */
fun statusText(d: Download): String = when (d.state) {
    DownloadState.QUEUED -> "Queued"
    DownloadState.WAITING -> "Waiting for network"
    DownloadState.DOWNLOADING -> "${(d.progress * 100).toInt()}% · ${formatBytes(d.bytes)} of ${formatBytes(d.total)}"
    DownloadState.DONE -> formatBytes(d.total)
    DownloadState.FAILED -> "Download failed"
}

/**
 * The per-title download control, as on Netflix: an arrow to start, a filling ring while it comes
 * down (tap to cancel), a pin once it is on the phone (tap to play or delete), a warning on failure.
 */
@Composable
fun DownloadIcon(
    download: Download?,
    onStart: () -> Unit,
    onRemove: (Download) -> Unit,
    onRetry: (Download) -> Unit,
    modifier: Modifier = Modifier,
    onPlay: ((Download) -> Unit)? = null,
) {
    var menu by remember { mutableStateOf(false) }
    Box(modifier) {
        IconButton(onClick = { if (download == null) onStart() else menu = true }, modifier = Modifier.testTag("download-icon")) {
            when {
                download == null -> Icon(Icons.Filled.Download, "Download", tint = Color.White)
                download.state == DownloadState.DONE -> Icon(Icons.Filled.OfflinePin, "Downloaded", tint = MaterialTheme.colorScheme.primary)
                download.state == DownloadState.FAILED -> Icon(Icons.Filled.ErrorOutline, "Download failed", tint = MaterialTheme.colorScheme.error)
                else -> Box(contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(
                        progress = { download.progress },
                        modifier = Modifier.size(26.dp),
                        strokeWidth = 2.5.dp,
                        trackColor = Color.White.copy(alpha = 0.25f),
                    )
                    Icon(Icons.Filled.Stop, "Downloading", Modifier.size(12.dp), tint = Color.White)
                }
            }
        }
        if (download != null) DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            when (download.state) {
                DownloadState.DONE -> {
                    onPlay?.let { play -> DropdownMenuItem(text = { Text("Play") }, onClick = { menu = false; play(download) }) }
                    DropdownMenuItem(text = { Text("Delete download") }, onClick = { menu = false; onRemove(download) }, modifier = Modifier.testTag("download-delete"))
                }
                DownloadState.FAILED -> {
                    DropdownMenuItem(text = { Text("Retry download") }, onClick = { menu = false; onRetry(download) })
                    DropdownMenuItem(text = { Text("Remove") }, onClick = { menu = false; onRemove(download) })
                }
                else -> DropdownMenuItem(text = { Text("Cancel download") }, onClick = { menu = false; onRemove(download) }, modifier = Modifier.testTag("download-cancel"))
            }
        }
    }
}

/** The item page's download control: a button to start, then progress, then "Downloaded". */
@Composable
fun DownloadPanel(download: Download?, sizeBytes: Long?, onStart: () -> Unit, onRemove: (Download) -> Unit, onRetry: (Download) -> Unit, modifier: Modifier = Modifier) {
    if (download == null) {
        OutlinedButton(onClick = onStart, modifier = modifier.fillMaxWidth().testTag("download")) {
            Icon(Icons.Filled.Download, null, tint = Color.White)
            Text(listOfNotNull(" Download", sizeBytes?.let(::formatBytes)).joinToString(" · "), color = Color.White)
        }
        return
    }
    Column(modifier.fillMaxWidth().testTag("download-status"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            when (download.state) {
                DownloadState.DONE -> Icon(Icons.Filled.OfflinePin, null, tint = MaterialTheme.colorScheme.primary)
                DownloadState.FAILED -> Icon(Icons.Filled.ErrorOutline, null, tint = MaterialTheme.colorScheme.error)
                else -> CircularProgressIndicator(progress = { download.progress }, modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
            }
            val label = when (download.state) {
                DownloadState.DONE -> "Downloaded · ${formatBytes(download.total)}"
                DownloadState.FAILED -> "Download failed"
                else -> "Downloading · ${statusText(download)}"
            }
            Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = Color.White)
            if (download.state == DownloadState.FAILED) TextButton(onClick = { onRetry(download) }) { Text("Retry") }
            TextButton(onClick = { onRemove(download) }, modifier = Modifier.testTag("download-remove")) {
                Text(if (download.isActive) "Cancel" else "Delete")
            }
        }
        if (download.isActive) LinearProgressIndicator(progress = { download.progress }, modifier = Modifier.fillMaxWidth())
    }
}
