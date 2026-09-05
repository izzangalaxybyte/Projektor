package app.projektor.mobile.ui.live

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.projektor.core.api.models.Recording
import app.projektor.core.live.LiveGuide
import app.projektor.mobile.AppContainer
import app.projektor.mobile.ui.item.formatMs
import app.projektor.mobile.ui.userMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Recordings the server made or will make: play, stop, cancel, delete. Polls while any is active. */
@Composable
fun RecordingsScreen(container: AppContainer, play: (String) -> Unit, back: () -> Unit) {
    val live = container.live() ?: return
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<List<Recording>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var version by remember { mutableStateOf(0) }
    LaunchedEffect(version) {
        while (true) {
            try { list = live.recordings(); error = null } catch (e: Exception) { error = e.userMessage() }
            val active = list?.any { it.state.value == "scheduled" || it.state.value == "recording" } == true
            delay(if (active) 3_000 else 30_000)
        }
    }
    fun refresh() { version += 1 }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text("Recordings", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
            Text("${list?.size ?: 0}", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("recording-count"))
        }
        error?.let { Text(it, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error) }
        val items = list
        if (items != null && items.isEmpty()) Text("Nothing recorded yet. Use ● Rec on a channel, or ● Record on a programme in the guide.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag("recording-list")) {
            items(items.orEmpty(), key = { it.id }) { r ->
                val playable = r.state.value == "done" || r.state.value == "recording" || (r.state.value == "failed" && r.sizeBytes > 0)
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surface).padding(12.dp).testTag("recording-${r.id}")) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(r.title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                        Text(
                            when (r.state.value) { "scheduled" -> "Scheduled"; "recording" -> "Recording…"; "done" -> "Done"; else -> "Failed" },
                            style = MaterialTheme.typography.labelSmall,
                            color = if (r.state.value == "recording" || r.state.value == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.testTag("rec-state"),
                        )
                    }
                    Text(
                        buildString {
                            append(r.channelName); append(" · "); append(LiveGuide.clock(r.startAt))
                            r.endAt?.let { append("–"); append(LiveGuide.clock(it)) }
                            r.durationMs?.let { append(" · "); append(formatMs(it.toLong())) }
                            if (r.sizeBytes > 0) { append(" · "); append("${r.sizeBytes / 1024 / 1024} MB") }
                            r.error?.let { append(" · "); append(it) }
                        },
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (playable) Button(onClick = { play(r.id) }, modifier = Modifier.testTag("play")) { Text("Play") }
                        if (r.state.value == "recording") OutlinedButton(onClick = { scope.launch { runCatching { live.stopRecording(r.id) }; refresh() } }, modifier = Modifier.testTag("stop")) { Text("Stop") }
                        if (r.state.value == "scheduled") OutlinedButton(onClick = { scope.launch { runCatching { live.stopRecording(r.id) }; refresh() } }, modifier = Modifier.testTag("cancel")) { Text("Cancel") }
                        if (r.state.value != "scheduled") TextButton(onClick = { scope.launch { runCatching { live.deleteRecording(r.id) }; refresh() } }, modifier = Modifier.testTag("delete")) { Text("Delete", color = MaterialTheme.colorScheme.error) }
                    }
                }
            }
        }
    }
}
