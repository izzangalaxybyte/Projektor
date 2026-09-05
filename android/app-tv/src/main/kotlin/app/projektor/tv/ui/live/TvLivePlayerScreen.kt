package app.projektor.tv.ui.live

import android.view.KeyEvent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.ui.PlayerView
import androidx.tv.material3.Button
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import app.projektor.core.api.models.LiveChannel
import app.projektor.core.api.models.LiveDecideRequestInput
import app.projektor.core.api.models.LivePlaybackDecision
import app.projektor.core.api.models.LiveProgramme
import app.projektor.core.live.LiveGuide
import app.projektor.core.playback.DeviceProfiles
import app.projektor.player.ProjektorPlayer
import app.projektor.player.liveMediaSpecFor
import app.projektor.tv.TvContainer
import app.projektor.tv.ui.userMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * A live channel on the TV. Channel Up/Down (and D-pad Up/Down) change channel, digits jump to a
 * channel number, Centre shows the info bar, Right opens the guide where finished programmes
 * play from catch-up, Back leaves.
 */
@Composable
fun TvLivePlayerScreen(container: TvContainer, channelId: String, openCatchup: (channelId: String, programmeId: String) -> Unit, back: () -> Unit) {
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
    var infoVisible by remember { mutableStateOf(true) }
    var digits by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var lastInteraction by remember { mutableStateOf(System.currentTimeMillis()) }
    val channel = channels.firstOrNull { it.id == current }

    val player = remember { ProjektorPlayer(context) }
    val state by player.state.collectAsState()
    val rootFocus = remember { FocusRequester() }
    val guideFocus = remember { FocusRequester() }

    DisposableEffect(Unit) {
        view.keepScreenOn = true
        onDispose {
            view.keepScreenOn = false
            val sid = decision?.sessionId
            scope.launch { player.release(); sid?.let { live.releaseSession(it) } }
        }
    }
    LaunchedEffect(Unit) {
        while (true) {
            runCatching { live.channels() }.onSuccess { channels = it }
            delay(60_000)
        }
    }
    LaunchedEffect(current) {
        val previous = decision?.sessionId
        decision = null
        guide = null
        error = null
        infoVisible = true
        try {
            val d = live.decide(LiveDecideRequestInput(profile = DeviceProfiles.current(), channelId = current))
            decision = d
            player.load(liveMediaSpecFor(d, client))
            rootFocus.requestFocus()
        } catch (e: Exception) { error = e.userMessage() }
        previous?.let { live.releaseSession(it) }
    }
    LaunchedEffect(showGuide, current) {
        if (showGuide) {
            if (guide == null) guide = runCatching { live.guide(current) }.getOrDefault(emptyList())
            delay(50)
            runCatching { guideFocus.requestFocus() }
        }
    }
    LaunchedEffect(infoVisible, lastInteraction, showGuide) {
        if (infoVisible && !showGuide) {
            delay(4_000)
            if (System.currentTimeMillis() - lastInteraction >= 3_900) infoVisible = false
        }
    }
    // Digits commit a moment after the last one.
    LaunchedEffect(digits) {
        if (digits.isEmpty()) return@LaunchedEffect
        delay(LiveGuide.NUMBER_ENTRY_COMMIT_MS)
        val target = LiveGuide.byNumber(channels, digits) { it.number }
        digits = ""
        if (target != null) current = target.id
    }
    fun touched() { lastInteraction = System.currentTimeMillis(); infoVisible = true }
    fun step(direction: Int) { LiveGuide.neighbour(channels, current, direction) { it.id }?.let { current = it.id }; touched() }

    BackHandler {
        when {
            showGuide -> { showGuide = false; rootFocus.requestFocus() }
            else -> back()
        }
    }

    Box(
        Modifier.fillMaxSize().background(Color.Black).focusRequester(rootFocus).focusable()
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                val code = event.nativeKeyEvent.keyCode
                when (code) {
                    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> { player.togglePlayPause(); touched(); return@onPreviewKeyEvent true }
                    KeyEvent.KEYCODE_CHANNEL_UP -> { step(1); return@onPreviewKeyEvent true }
                    KeyEvent.KEYCODE_CHANNEL_DOWN -> { step(-1); return@onPreviewKeyEvent true }
                }
                if (code in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9) {
                    digits = (digits + (code - KeyEvent.KEYCODE_0)).takeLast(4)
                    touched()
                    return@onPreviewKeyEvent true
                }
                if (showGuide) return@onPreviewKeyEvent false
                when (code) {
                    KeyEvent.KEYCODE_DPAD_UP -> { step(1); true }
                    KeyEvent.KEYCODE_DPAD_DOWN -> { step(-1); true }
                    KeyEvent.KEYCODE_DPAD_RIGHT -> { showGuide = true; touched(); true }
                    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> { if (infoVisible) player.togglePlayPause(); touched(); true }
                    else -> false
                }
            },
    ) {
        AndroidView(factory = { ctx -> PlayerView(ctx).apply { useController = false; this.player = player.exo } }, modifier = Modifier.fillMaxSize())
        Text(state.positionMs.toString(), Modifier.width(1.dp).height(1.dp).testTag("position-ms"), color = Color.Transparent)
        error?.let { Text(it, Modifier.align(Alignment.Center).padding(32.dp), color = MaterialTheme.colorScheme.error) }
        if (state.isBuffering && error == null) Text("…", Modifier.align(Alignment.Center), style = MaterialTheme.typography.displayMedium)
        if (digits.isNotEmpty()) {
            Text(digits, Modifier.align(Alignment.TopEnd).padding(40.dp).background(Color.Black.copy(alpha = 0.7f)).padding(horizontal = 24.dp, vertical = 8.dp).testTag("number-entry"), style = MaterialTheme.typography.displayMedium)
        }
        if (infoVisible || showGuide) {
            Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().background(Color.Black.copy(alpha = 0.7f)).padding(horizontal = 40.dp, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(channel?.let { listOfNotNull(it.number?.toString(), it.name).joinToString(" ") } ?: "…", style = MaterialTheme.typography.titleLarge, modifier = Modifier.testTag("channel-name"))
                Text(decision?.let { if (it.method == LivePlaybackDecision.Method.DIRECT) "Live · Direct" else "Live · HLS" } ?: "", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("decision"))
                val now = channel?.now
                if (now != null) {
                    Text(now.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.testTag("now-title"))
                    Text("${LiveGuide.clock(now.startAt)}–${LiveGuide.clock(now.endAt)}${channel.next?.let { " · Next: ${it.title}" } ?: ""}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Box(Modifier.fillMaxWidth().height(6.dp).background(MaterialTheme.colorScheme.surfaceVariant)) {
                        Box(Modifier.fillMaxWidth(LiveGuide.progress(now.startAt, now.endAt)).fillMaxHeight().background(MaterialTheme.colorScheme.primary))
                    }
                } else Text("No guide information", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Up/Down: channel · digits: channel number · Right: guide · Centre: pause", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (showGuide) {
            Column(Modifier.align(Alignment.CenterEnd).fillMaxHeight().width(520.dp).background(Color.Black.copy(alpha = 0.9f)).padding(24.dp).testTag("guide-panel"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(channel?.name ?: "Guide", style = MaterialTheme.typography.titleLarge)
                val list = guide
                if (list == null) Text("Loading…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                else if (list.isEmpty()) Text("No programmes listed.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                else LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    itemsIndexed(list, key = { _, p -> p.id }) { i, p ->
                        val ended = LiveGuide.hasEnded(p.endAt)
                        val playable = ended && channel != null && LiveGuide.inArchive(p.startAt, channel.hasArchive, channel.archiveDays)
                        Button(
                            onClick = { if (playable) openCatchup(current, p.id) },
                            modifier = Modifier.fillMaxWidth().testTag(if (playable) "catchup-play" else "guide-row").let { if (i == 0) it.focusRequester(guideFocus) else it },
                        ) {
                            Column {
                                Text("${LiveGuide.clock(p.startAt)}  ${p.title}${if (playable) "  ▶" else ""}", style = MaterialTheme.typography.bodyLarge)
                                p.description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1) }
                            }
                        }
                    }
                }
            }
        }
    }
}
