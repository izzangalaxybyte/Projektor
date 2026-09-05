package app.projektor.mobile.ui.live

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
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
import app.projektor.core.api.models.LiveDecideRequestInput
import app.projektor.core.api.models.LivePlaybackDecision
import app.projektor.core.playback.DeviceProfiles
import app.projektor.core.playback.RATE_OPTIONS
import app.projektor.core.playback.SKIP_OPTIONS
import app.projektor.core.playback.formatRate
import app.projektor.mobile.AppContainer
import app.projektor.mobile.ui.item.formatMs
import app.projektor.mobile.ui.player.Picker
import app.projektor.mobile.ui.userMessage
import app.projektor.player.ProjektorPlayer
import app.projektor.player.liveMediaSpecFor
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** What to ask the server to play: a catch-up programme, an IPTV movie, or a series episode. */
sealed interface ProviderSource {
    val request: (profile: app.projektor.core.api.models.DeviceProfileInput) -> LiveDecideRequestInput
    data class Catchup(val channelId: String, val programmeId: String) : ProviderSource {
        override val request = { p: app.projektor.core.api.models.DeviceProfileInput -> LiveDecideRequestInput(profile = p, channelId = channelId, programmeId = programmeId) }
    }
    data class Movie(val vodId: String) : ProviderSource {
        override val request = { p: app.projektor.core.api.models.DeviceProfileInput -> LiveDecideRequestInput(profile = p, vodId = vodId) }
    }
    data class Recording(val recordingId: String) : ProviderSource {
        override val request = { p: app.projektor.core.api.models.DeviceProfileInput -> LiveDecideRequestInput(profile = p, recordingId = recordingId) }
    }
    data class Episode(val episodeId: String) : ProviderSource {
        override val request = { p: app.projektor.core.api.models.DeviceProfileInput -> LiveDecideRequestInput(profile = p, episodeId = episodeId) }
    }
}

/**
 * Seekable provider content (catch-up now; IPTV movies and episodes later). Same skip-amount and
 * speed controls as the file player, no audio or subtitle pickers, no progress reports.
 */
@Composable
fun CatchupPlayerScreen(container: AppContainer, source: ProviderSource, back: () -> Unit) {
    val live = container.live() ?: return
    val client = container.client() ?: return
    val context = LocalContext.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val settings by container.playerPrefs.settings.collectAsState()

    var decision by remember { mutableStateOf<LivePlaybackDecision?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var controlsVisible by remember { mutableStateOf(true) }
    var lastInteraction by remember { mutableStateOf(System.currentTimeMillis()) }

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
    LaunchedEffect(source) {
        try {
            val d = live.decide(source.request(DeviceProfiles.current()))
            decision = d
            player.load(liveMediaSpecFor(d, client), rate = settings.rate, knownDurationMs = (d.durationMs ?: 0).toLong())
        } catch (e: Exception) { error = e.userMessage() }
    }
    LaunchedEffect(settings.rate) { player.setRate(settings.rate) }
    LaunchedEffect(controlsVisible, state.isPlaying, lastInteraction) {
        if (controlsVisible && state.isPlaying) {
            delay(3_500)
            if (System.currentTimeMillis() - lastInteraction >= 3_400) controlsVisible = false
        }
    }
    fun touched() { lastInteraction = System.currentTimeMillis(); controlsVisible = true }
    fun skip(direction: Int) { player.skip(direction * settings.skipMs); touched() }

    BackHandler { back() }

    Box(
        Modifier.fillMaxSize().background(Color.Black).pointerInput(settings.skipSeconds) {
            detectTapGestures(
                onTap = { touched(); controlsVisible = !controlsVisible },
                onDoubleTap = { offset -> skip(if (offset.x < size.width / 2) -1 else 1) },
            )
        },
    ) {
        AndroidView(factory = { ctx -> PlayerView(ctx).apply { useController = false; this.player = player.exo } }, modifier = Modifier.fillMaxSize())
        Text(state.positionMs.toString(), Modifier.size(1.dp).testTag("position-ms"), color = Color.Transparent)
        if (state.isBuffering && error == null) CircularProgressIndicator(Modifier.align(Alignment.Center))
        error?.let { Text(it, Modifier.align(Alignment.Center).padding(24.dp), color = MaterialTheme.colorScheme.error) }

        if (controlsVisible || !state.isPlaying) {
            Row(Modifier.align(Alignment.TopStart).fillMaxWidth().background(Color.Black.copy(alpha = 0.55f)).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = back, modifier = Modifier.testTag("back")) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                Column(Modifier.weight(1f)) {
                    Text(decision?.title ?: "", style = MaterialTheme.typography.titleMedium, modifier = Modifier.testTag("catchup-title"))
                    decision?.let { Text(badge(it), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("decision")) }
                }
            }
            Row(Modifier.align(Alignment.Center), horizontalArrangement = Arrangement.spacedBy(32.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { skip(-1) }, modifier = Modifier.size(64.dp).testTag("skip-back").semantics { contentDescription = "Skip back ${settings.skipSeconds} seconds" }) { Icon(Icons.Filled.Replay10, null, Modifier.size(40.dp)) }
                IconButton(onClick = { player.togglePlayPause(); touched() }, modifier = Modifier.size(80.dp).testTag("toggle").semantics { contentDescription = if (state.isPlaying) "Pause" else "Play" }) {
                    Icon(if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, null, Modifier.size(56.dp))
                }
                IconButton(onClick = { skip(1) }, modifier = Modifier.size(64.dp).testTag("skip-forward").semantics { contentDescription = "Skip forward ${settings.skipSeconds} seconds" }) { Icon(Icons.Filled.Forward10, null, Modifier.size(40.dp)) }
            }
            Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().background(Color.Black.copy(alpha = 0.6f)).padding(horizontal = 12.dp, vertical = 8.dp)) {
                val duration = if (state.durationMs > 0) state.durationMs else (decision?.durationMs ?: 0).toLong()
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(formatMs(state.positionMs), style = MaterialTheme.typography.labelMedium)
                    Slider(
                        value = state.positionMs.toFloat().coerceIn(0f, duration.coerceAtLeast(1).toFloat()),
                        onValueChange = { player.seekTo(it.toLong()); touched() },
                        valueRange = 0f..duration.coerceAtLeast(1).toFloat(),
                        modifier = Modifier.weight(1f).testTag("seek"),
                    )
                    Text(formatMs(duration), style = MaterialTheme.typography.labelMedium)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Picker(label = "Skip +${settings.skipSeconds}s", options = SKIP_OPTIONS.map { it to "+${it}s" }, onPick = { container.playerPrefs.update(skipSeconds = it); touched() }, tag = "skip-select")
                    Picker(label = formatRate(settings.rate), options = RATE_OPTIONS.map { it to formatRate(it) }, onPick = { container.playerPrefs.update(rate = it); touched() }, tag = "speed-select")
                }
            }
        }
    }
}

private fun badge(d: LivePlaybackDecision): String = when (d.kind) {
    LivePlaybackDecision.Kind.CATCHUP -> "Catch-up"
    LivePlaybackDecision.Kind.LIVE -> "Live"
    LivePlaybackDecision.Kind.RECORDING -> "Recording"
    LivePlaybackDecision.Kind.VOD -> if (d.method == LivePlaybackDecision.Method.DIRECT) "Direct play" else "Remux"
}
