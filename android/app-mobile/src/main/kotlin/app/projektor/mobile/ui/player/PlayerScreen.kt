package app.projektor.mobile.ui.player

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.ui.PlayerView
import app.projektor.player.showWithStackedSubtitles
import app.projektor.core.api.models.ItemDetail
import app.projektor.core.api.models.MediaFile
import app.projektor.core.api.models.PlaybackDecideRequestInput
import app.projektor.core.api.models.PlaybackDecision
import app.projektor.core.api.models.PlaybackMethod
import app.projektor.core.items.closestVersion
import app.projektor.core.playback.DeviceProfiles
import app.projektor.core.playback.HOLD_RATE_OPTIONS
import app.projektor.core.playback.RATE_OPTIONS
import app.projektor.core.playback.SKIP_OPTIONS
import app.projektor.core.playback.formatRate
import app.projektor.mobile.AppContainer
import app.projektor.mobile.ui.item.formatMs
import app.projektor.mobile.ui.userMessage
import app.projektor.player.ProjektorPlayer
import app.projektor.player.mediaSpecFor
import kotlinx.coroutines.delay

/**
 * Fullscreen playback. Skip back/forward and double taps jump by exactly the chosen amount; the
 * amount and the speed are chosen in the bottom bar and persist.
 */
@Composable
fun PlayerScreen(container: AppContainer, fileId: String, itemId: String, startMs: Long, playNext: (fileId: String, itemId: String) -> Unit, back: () -> Unit) {
    val items = container.items() ?: return
    val client = container.client() ?: return
    val context = LocalContext.current
    val settings by container.playerPrefs.settings.collectAsState()

    var detail by remember { mutableStateOf<ItemDetail?>(null) }
    var file by remember { mutableStateOf<MediaFile?>(null) }
    var decision by remember { mutableStateOf<PlaybackDecision?>(null) }
    var audioIndex by remember { mutableStateOf<Long?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var controlsVisible by remember { mutableStateOf(true) }
    var lastInteraction by remember { mutableStateOf(System.currentTimeMillis()) }
    var resumeAt by remember { mutableStateOf(startMs) }
    var nextEpisode by remember { mutableStateOf<Pair<String, String>?>(null) }

    val player = remember {
        ProjektorPlayer(context, onProgress = { pos, dur -> runCatching { items.reportProgress(itemId, pos, dur) } })
    }
    val state by player.state.collectAsState()

    PlayerWindow(player)

    // Load detail once, then decide (again whenever the audio track changes).
    LaunchedEffect(itemId) {
        try {
            val d = items.detail(itemId)
            detail = d
            file = d.files.firstOrNull { it.id == fileId } ?: d.files.firstOrNull()
            if (d.kind.value == "episode") {
                runCatching { items.nextEpisode(d.id) }.getOrNull()?.let { n ->
                    // Keep to the release being watched when the next episode has several files.
                runCatching { items.detail(n.id) }.getOrNull()?.files?.let { closestVersion(file?.fileName, it) }?.let { f -> nextEpisode = f.id to n.id }
                }
            }
        } catch (e: Exception) { error = e.userMessage() }
    }
    LaunchedEffect(file, audioIndex) {
        val f = file ?: return@LaunchedEffect
        try {
            val profile = DeviceProfiles.current()
            val d = items.decide(PlaybackDecideRequestInput(fileId = f.id, profile = profile, audioStreamIndex = audioIndex, startPositionMs = resumeAt))
            decision = d
            // Direct play keeps every audio track; pin the chosen one (or the server's default pick).
            val audio = f.streams.filter { it.type.value == "audio" }
            val wanted = audio.indexOfFirst { it.index == audioIndex }.takeIf { it >= 0 }
                ?: audio.indexOfFirst { it.isDefault }.takeIf { it >= 0 } ?: 0
            player.load(
                mediaSpecFor(d, client),
                startMs = resumeAt,
                rate = settings.rate,
                knownDurationMs = f.durationMs.toLong(),
                audioOrdinal = wanted.takeIf { d.method == PlaybackMethod.DIRECT && audio.size > 1 },
            )
        } catch (e: Exception) { error = e.userMessage() }
    }
    // Holding the screen plays at the hold speed until it's let go.
    var boosting by remember { mutableStateOf(false) }
    LaunchedEffect(settings.rate, settings.holdRate, boosting) { player.setRate(if (boosting) settings.holdRate else settings.rate) }

    // Auto-hide controls while playing.
    LaunchedEffect(controlsVisible, state.isPlaying, lastInteraction) {
        if (controlsVisible && state.isPlaying) {
            delay(3_500)
            if (System.currentTimeMillis() - lastInteraction >= 3_400) controlsVisible = false
        }
    }
    fun touched() { lastInteraction = System.currentTimeMillis(); controlsVisible = true }
    // Double taps seek without bringing the controls up; while they're up, any skip keeps them there.
    fun skip(direction: Int) { player.skip(direction * settings.skipMs); if (controlsVisible) touched() }
    fun exit() { player.pause(); back() }

    BackHandler { exit() }

    Box(
        Modifier.fillMaxSize().background(Color.Black).pointerInput(settings.skipSeconds) {
            detectTapGestures(
                onTap = { if (controlsVisible) controlsVisible = false else touched() },
                onDoubleTap = { offset -> skip(if (offset.x < size.width / 2) -1 else 1) },
                onLongPress = { if (state.isPlaying) boosting = true },
                onPress = { tryAwaitRelease(); boosting = false },
            )
        },
    ) {
        AndroidView(
            factory = { ctx -> PlayerView(ctx).apply { useController = false; showWithStackedSubtitles(player) } },
            modifier = Modifier.fillMaxSize(),
        )
        // Hidden probes for tests: position in ms and current rate.
        Text(state.positionMs.toString(), Modifier.size(1.dp).testTag("position-ms"), color = Color.Transparent)
        Text(settings.rate.toString(), Modifier.size(1.dp).testTag("rate"), color = Color.Transparent)

        if (state.isBuffering && error == null) CircularProgressIndicator(Modifier.align(Alignment.Center))
        error?.let { Text(it, Modifier.align(Alignment.Center).padding(24.dp), color = MaterialTheme.colorScheme.error) }
        if (boosting) SpeedBoostBadge(settings.holdRate, Modifier.align(Alignment.TopCenter).padding(top = 24.dp))
        if (state.ended && nextEpisode != null) {
            Button(onClick = { nextEpisode?.let { (f, i) -> playNext(f, i) } }, modifier = Modifier.align(Alignment.Center).testTag("next-episode")) { Text("Play next episode") }
        }

        if (controlsVisible || state.isPaused) PlayerChrome {
            // Top bar
            Row(Modifier.align(Alignment.TopStart).fillMaxWidth().then(TopScrim).padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 24.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = ::exit, modifier = Modifier.testTag("back")) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                Column(Modifier.weight(1f)) {
                    Text(detail?.let { d -> if (d.kind.value == "episode") "${d.showTitle ?: ""} · ${d.title}" else d.title } ?: "", style = MaterialTheme.typography.titleMedium)
                    decision?.let { Text(badge(it), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("decision")) }
                }
            }
            // Center transport: back N · play/pause · forward N
            Row(Modifier.align(Alignment.Center), horizontalArrangement = Arrangement.spacedBy(32.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { skip(-1) }, modifier = Modifier.size(64.dp).then(ButtonScrim).testTag("skip-back").semantics { contentDescription = "Skip back ${settings.skipSeconds} seconds" }) {
                    Icon(Icons.Filled.Replay10, null, Modifier.size(40.dp))
                }
                IconButton(onClick = { player.togglePlayPause(); touched() }, modifier = Modifier.size(80.dp).then(ButtonScrim).testTag("toggle").semantics { contentDescription = if (state.isPlaying) "Pause" else "Play" }) {
                    Icon(if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, null, Modifier.size(56.dp))
                }
                IconButton(onClick = { skip(1) }, modifier = Modifier.size(64.dp).then(ButtonScrim).testTag("skip-forward").semantics { contentDescription = "Skip forward ${settings.skipSeconds} seconds" }) {
                    Icon(Icons.Filled.Forward10, null, Modifier.size(40.dp))
                }
            }
            // Bottom bar
            Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().then(BottomScrim).padding(start = 12.dp, end = 12.dp, top = 24.dp, bottom = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(formatMs(state.positionMs), style = MaterialTheme.typography.labelMedium)
                    Slider(
                        value = state.positionMs.toFloat().coerceIn(0f, state.durationMs.coerceAtLeast(1).toFloat()),
                        onValueChange = { player.seekTo(it.toLong()); touched() },
                        valueRange = 0f..state.durationMs.coerceAtLeast(1).toFloat(),
                        modifier = Modifier.weight(1f).testTag("seek"),
                    )
                    Text(formatMs(state.durationMs), style = MaterialTheme.typography.labelMedium)
                }
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Picker(
                        label = "Skip +${settings.skipSeconds}s",
                        options = SKIP_OPTIONS.map { it to "+${it}s" },
                        onPick = { container.playerPrefs.update(skipSeconds = it); touched() },
                        tag = "skip-select",
                    )
                    Picker(
                        label = formatRate(settings.rate),
                        options = RATE_OPTIONS.map { it to formatRate(it) },
                        onPick = { container.playerPrefs.update(rate = it); touched() },
                        tag = "speed-select",
                    )
                    Picker(
                        label = "Hold ${formatRate(settings.holdRate)}",
                        options = HOLD_RATE_OPTIONS.map { it to formatRate(it) },
                        onPick = { container.playerPrefs.update(holdRate = it); touched() },
                        tag = "hold-speed-select",
                    )
                    val audioTracks = file?.streams?.filter { it.type.value == "audio" }.orEmpty()
                    if (audioTracks.size > 1) {
                        val current = audioTracks.firstOrNull { it.index == audioIndex } ?: audioTracks.firstOrNull { it.isDefault } ?: audioTracks.first()
                        Picker(
                            label = "Audio: ${current.title ?: current.language ?: current.index}",
                            options = audioTracks.map { it.index to "${it.title ?: it.language ?: "Track ${it.index}"} (${it.codec})" },
                            onPick = { resumeAt = state.positionMs; audioIndex = it; touched() },
                            tag = "audio-select",
                        )
                    }
                    if (state.subtitleTracks.isNotEmpty()) {
                        val current = state.subtitleTracks.firstOrNull { it.id == state.selectedSubtitle }
                        Picker(
                            label = "Subtitles: ${current?.label ?: "off"}",
                            options = listOf<Pair<String?, String>>(null to "Off") + state.subtitleTracks.map { it.id to it.label },
                            onPick = { player.selectSubtitle(it); touched() },
                            tag = "subtitle-select",
                        )
                    }
                    Spacer(Modifier.width(4.dp))
                }
            }
        }
    }
}

@Composable
internal fun <T> Picker(label: String, options: List<Pair<T, String>>, onPick: (T) -> Unit, tag: String) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }, modifier = Modifier.testTag(tag)) { Text(label, style = MaterialTheme.typography.labelMedium) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (value, text) ->
                DropdownMenuItem(text = { Text(text) }, onClick = { open = false; onPick(value) }, modifier = Modifier.testTag("$tag-$text"))
            }
        }
    }
}

private fun badge(d: PlaybackDecision): String = when (d.method) {
    PlaybackMethod.DIRECT -> "Direct play"
    PlaybackMethod.REMUX -> "Remux"
    PlaybackMethod.TRANSCODE -> "Transcoding"
}
