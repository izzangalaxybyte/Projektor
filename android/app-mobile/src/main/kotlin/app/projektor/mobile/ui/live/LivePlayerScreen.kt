package app.projektor.mobile.ui.live

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.ui.PlayerView
import app.projektor.core.api.models.CreateRecordingRequestInput
import app.projektor.core.api.models.LiveChannel
import app.projektor.core.api.models.LiveDecideRequestInput
import app.projektor.core.api.models.LivePlaybackDecision
import app.projektor.core.api.models.LiveProgramme
import app.projektor.core.live.LiveGuide
import app.projektor.core.playback.DeviceProfiles
import app.projektor.mobile.AppContainer
import app.projektor.mobile.ui.userMessage
import app.projektor.player.ProjektorPlayer
import app.projektor.player.liveMediaSpecFor
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * A live channel. No seek bar: the stream follows the live edge. Channel up/down buttons switch
 * channels in place; the guide lists the day's programmes and plays finished ones from catch-up.
 */
@Composable
fun LivePlayerScreen(container: AppContainer, channelId: String, openCatchup: (channelId: String, programmeId: String) -> Unit, back: () -> Unit) {
    val live = container.live() ?: return
    val client = container.client() ?: return
    val context = LocalContext.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()

    var current by remember { mutableStateOf(channelId) }
    var channels by remember { mutableStateOf<List<LiveChannel>>(emptyList()) }
    var decision by remember { mutableStateOf<LivePlaybackDecision?>(null) }
    var guide by remember { mutableStateOf<List<LiveProgramme>?>(null) }
    var showGuide by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var controlsVisible by remember { mutableStateOf(true) }
    var lastInteraction by remember { mutableStateOf(System.currentTimeMillis()) }
    var notice by remember { mutableStateOf<String?>(null) }
    val channel = channels.firstOrNull { it.id == current }
    fun record(programmeId: String? = null) {
        scope.launch {
            notice = try {
                val r = live.record(CreateRecordingRequestInput(channelId = current, programmeId = programmeId))
                if (r.state.value == "scheduled") "Scheduled: ${r.title}" else "Recording: ${r.title}"
            } catch (e: Exception) { e.userMessage() }
        }
    }
    LaunchedEffect(notice) { if (notice != null) { delay(4_000); notice = null } }

    val player = remember { ProjektorPlayer(context) }
    val state by player.state.collectAsState()

    DisposableEffect(Unit) {
        val window = (context as? Activity)?.window
        val controller = window?.let { WindowInsetsControllerCompat(it, view) }
        controller?.hide(WindowInsetsCompat.Type.systemBars())
        window?.let { WindowCompat.setDecorFitsSystemWindows(it, false) }
        view.keepScreenOn = true
        onDispose {
            view.keepScreenOn = false
            controller?.show(WindowInsetsCompat.Type.systemBars())
            val sid = decision?.sessionId
            scope.launch { player.release(); sid?.let { live.releaseSession(it) } }
        }
    }
    // The channel list, refreshed each minute so now/next stay right.
    LaunchedEffect(Unit) {
        while (true) {
            runCatching { live.channels() }.onSuccess { channels = it }
            delay(60_000)
        }
    }
    // Decide and load whenever the channel changes; release the previous HLS session if any.
    LaunchedEffect(current) {
        val previous = decision?.sessionId
        decision = null
        guide = null
        error = null
        try {
            val d = live.decide(LiveDecideRequestInput(profile = DeviceProfiles.current(), channelId = current))
            decision = d
            player.load(liveMediaSpecFor(d, client))
        } catch (e: Exception) { error = e.userMessage() }
        previous?.let { live.releaseSession(it) }
    }
    LaunchedEffect(showGuide, current) {
        if (showGuide && guide == null) guide = runCatching { live.guide(current) }.getOrDefault(emptyList())
    }
    LaunchedEffect(controlsVisible, state.isPlaying, lastInteraction, showGuide) {
        if (controlsVisible && state.isPlaying && !showGuide) {
            delay(3_500)
            if (System.currentTimeMillis() - lastInteraction >= 3_400) controlsVisible = false
        }
    }
    fun touched() { lastInteraction = System.currentTimeMillis(); controlsVisible = true }
    fun step(direction: Int) { LiveGuide.neighbour(channels, current, direction) { it.id }?.let { current = it.id }; touched() }

    BackHandler { if (showGuide) showGuide = false else back() }

    Box(
        Modifier.fillMaxSize().background(Color.Black).pointerInput(Unit) {
            detectTapGestures(onTap = { touched(); controlsVisible = !controlsVisible })
        },
    ) {
        AndroidView(factory = { ctx -> PlayerView(ctx).apply { useController = false; this.player = player.exo } }, modifier = Modifier.fillMaxSize())
        Text(state.positionMs.toString(), Modifier.size(1.dp).testTag("position-ms"), color = Color.Transparent)
        if (state.isBuffering && error == null) CircularProgressIndicator(Modifier.align(Alignment.Center))
        error?.let { Text(it, Modifier.align(Alignment.Center).padding(24.dp), color = MaterialTheme.colorScheme.error) }
        notice?.let { Text(it, Modifier.align(Alignment.TopCenter).padding(top = 72.dp).background(Color.Black.copy(alpha = 0.8f)).padding(horizontal = 16.dp, vertical = 8.dp).testTag("notice")) }

        if (controlsVisible || !state.isPlaying || showGuide) {
            Row(Modifier.align(Alignment.TopStart).fillMaxWidth().background(Color.Black.copy(alpha = 0.55f)).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = back, modifier = Modifier.testTag("back")) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                Column(Modifier.weight(1f)) {
                    Text(channel?.let { listOfNotNull(it.number?.toString(), it.name).joinToString(" ") } ?: "…", style = MaterialTheme.typography.titleMedium, modifier = Modifier.testTag("channel-name"))
                    Text(decision?.let { if (it.method == LivePlaybackDecision.Method.DIRECT) "Live · Direct" else "Live · HLS" } ?: "", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("decision"))
                }
            }
            Row(Modifier.align(Alignment.Center), horizontalArrangement = Arrangement.spacedBy(32.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { step(-1) }, modifier = Modifier.size(64.dp).testTag("channel-down").semantics { contentDescription = "Previous channel" }) { Icon(Icons.Filled.KeyboardArrowDown, null, Modifier.size(40.dp)) }
                IconButton(onClick = { player.togglePlayPause(); touched() }, modifier = Modifier.size(80.dp).testTag("toggle").semantics { contentDescription = if (state.isPlaying) "Pause" else "Play" }) {
                    Icon(if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, null, Modifier.size(56.dp))
                }
                IconButton(onClick = { step(1) }, modifier = Modifier.size(64.dp).testTag("channel-up").semantics { contentDescription = "Next channel" }) { Icon(Icons.Filled.KeyboardArrowUp, null, Modifier.size(40.dp)) }
            }
            Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().background(Color.Black.copy(alpha = 0.6f)).padding(horizontal = 12.dp, vertical = 8.dp)) {
                val now = channel?.now
                if (now != null) {
                    Text(now.title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.testTag("now-title"))
                    Text("${LiveGuide.clock(now.startAt)}–${LiveGuide.clock(now.endAt)}${channel.next?.let { " · Next: ${it.title}" } ?: ""}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Box(Modifier.fillMaxWidth().height(3.dp).background(MaterialTheme.colorScheme.surfaceVariant)) {
                        Box(Modifier.fillMaxWidth(LiveGuide.progress(now.startAt, now.endAt)).fillMaxHeight().background(MaterialTheme.colorScheme.primary))
                    }
                } else Text("No guide information", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { showGuide = !showGuide; touched() }, modifier = Modifier.testTag("guide-toggle")) { Text("Guide") }
                    OutlinedButton(onClick = { record(); touched() }, modifier = Modifier.testTag("record-now")) { Text("● Rec", color = MaterialTheme.colorScheme.error) }
                }
            }
        }
        if (showGuide) {
            Column(Modifier.align(Alignment.CenterEnd).fillMaxHeight().fillMaxWidth(0.55f).background(Color.Black.copy(alpha = 0.9f)).padding(12.dp).testTag("guide-panel")) {
                Text(channel?.name ?: "Guide", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(bottom = 8.dp))
                val list = guide
                if (list == null) CircularProgressIndicator(Modifier.padding(16.dp))
                else if (list.isEmpty()) Text("No programmes listed.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                else LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    items(list, key = { it.id }) { p ->
                        val ended = LiveGuide.hasEnded(p.endAt)
                        val playable = ended && channel != null && LiveGuide.inArchive(p.startAt, channel.hasArchive, channel.archiveDays)
                        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(LiveGuide.clock(p.startAt), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(p.title, style = MaterialTheme.typography.bodyMedium, color = if (ended && !playable) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                                p.description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2) }
                            }
                            if (playable) TextButton(onClick = { openCatchup(current, p.id) }, modifier = Modifier.testTag("catchup-play")) { Text("Watch") }
                            if (!ended) TextButton(onClick = { record(p.id) }, modifier = Modifier.testTag("record-programme")) { Text(if (LiveGuide.parseIso(p.startAt) <= System.currentTimeMillis()) "● Record" else "● Schedule") }
                        }
                    }
                }
            }
        }
    }
}
