package app.projektor.tv.ui.live

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Button
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import app.projektor.core.api.models.Recording
import app.projektor.core.live.LiveGuide
import app.projektor.tv.TvContainer
import app.projektor.tv.ui.formatMs
import app.projektor.tv.ui.userMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Recordings on the TV: a focusable list; Centre opens Play / Stop / Cancel / Delete for the row. */
@Composable
fun TvRecordings(container: TvContainer, play: (String) -> Unit, back: () -> Unit) {
    val live = container.live() ?: return
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<List<Recording>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var selected by remember { mutableStateOf<Recording?>(null) }
    var version by remember { mutableStateOf(0) }
    val firstFocus = remember { FocusRequester() }
    val actionFocus = remember { FocusRequester() }
    LaunchedEffect(version) {
        while (true) {
            try { list = live.recordings(); error = null } catch (e: Exception) { error = e.userMessage() }
            val active = list?.any { it.state.value == "scheduled" || it.state.value == "recording" } == true
            delay(if (active) 3_000 else 30_000)
        }
    }
    BackHandler { if (selected != null) { selected = null; runCatching { firstFocus.requestFocus() } } else back() }

    Box(Modifier.fillMaxSize().padding(48.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Recordings", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.testTag("recordings-title"))
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            val items = list
            if (items != null && items.isEmpty()) Text("Nothing recorded yet. Press the record key on a channel, or Centre on an upcoming programme in the guide.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(bottom = 24.dp), modifier = Modifier.testTag("recording-list")) {
                itemsIndexed(items.orEmpty(), key = { _, r -> r.id }) { i, r ->
                    // Ask for focus from inside the row so the request cannot run before it exists.
                    if (i == 0 && selected == null) LaunchedEffect(r.id) { runCatching { firstFocus.requestFocus() } }
                    Button(
                        onClick = { selected = r },
                        modifier = Modifier.fillMaxWidth().testTag("recording-${r.id}").let { if (i == 0) it.focusRequester(firstFocus) else it },
                    ) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(r.title, style = MaterialTheme.typography.titleMedium)
                                Text(
                                    buildString {
                                        append(r.channelName); append(" · "); append(LiveGuide.clock(r.startAt))
                                        r.endAt?.let { append("–"); append(LiveGuide.clock(it)) }
                                        r.durationMs?.let { append(" · "); append(formatMs(it.toLong())) }
                                        r.error?.let { append(" · "); append(it) }
                                    },
                                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Text(
                                when (r.state.value) { "scheduled" -> "Scheduled"; "recording" -> "● Recording"; "done" -> "Done"; else -> "Failed" },
                                style = MaterialTheme.typography.labelLarge,
                                color = if (r.state.value == "recording") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.testTag("rec-state-${r.id}"),
                            )
                        }
                    }
                }
            }
        }
        selected?.let { r ->
            val playable = r.state.value == "done" || r.state.value == "recording" || (r.state.value == "failed" && r.sizeBytes > 0)
            Column(Modifier.align(Alignment.CenterEnd).fillMaxHeight().width(360.dp).background(Color.Black.copy(alpha = 0.9f)).padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                LaunchedEffect(r.id) { runCatching { actionFocus.requestFocus() } }
                Text(r.title, style = MaterialTheme.typography.titleLarge)
                var first = true
                fun mod(tag: String): Modifier { val m = Modifier.fillMaxWidth().testTag(tag); return if (first) { first = false; m.focusRequester(actionFocus) } else m }
                if (playable) Button(onClick = { play(r.id) }, modifier = mod("play")) { Text("Play") }
                if (r.state.value == "recording") Button(onClick = { scope.launch { runCatching { live.stopRecording(r.id) }; selected = null; version += 1 } }, modifier = mod("stop")) { Text("Stop recording") }
                if (r.state.value == "scheduled") Button(onClick = { scope.launch { runCatching { live.stopRecording(r.id) }; selected = null; version += 1 } }, modifier = mod("cancel")) { Text("Cancel") }
                if (r.state.value != "scheduled") Button(onClick = { scope.launch { runCatching { live.deleteRecording(r.id) }; selected = null; version += 1 } }, modifier = mod("delete")) { Text("Delete") }
                Button(onClick = { selected = null }, modifier = mod("close")) { Text("Back") }
            }
        }
    }
}
