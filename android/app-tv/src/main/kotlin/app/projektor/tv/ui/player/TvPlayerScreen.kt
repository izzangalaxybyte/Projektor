package app.projektor.tv.ui.player

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
import androidx.compose.ui.input.key.nativeKeyCode
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
import app.projektor.core.api.models.ItemDetail
import app.projektor.core.api.models.MediaFile
import app.projektor.core.api.models.PlaybackDecideRequestInput
import app.projektor.core.api.models.PlaybackDecision
import app.projektor.core.api.models.PlaybackMethod
import app.projektor.core.playback.DeviceProfiles
import app.projektor.core.playback.RATE_OPTIONS
import app.projektor.core.playback.SKIP_OPTIONS
import app.projektor.core.playback.formatRate
import app.projektor.player.ProjektorPlayer
import app.projektor.player.mediaSpecFor
import app.projektor.tv.TvContainer
import app.projektor.tv.ui.formatMs
import app.projektor.tv.ui.userMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private enum class Picker { SKIP, SPEED, AUDIO, SUBTITLES }

/**
 * Remote-driven playback. With the controls hidden, Left/Right (and rewind/fast-forward) jump by
 * the chosen skip amount and Centre/Play-Pause toggles; Up/Down shows the control bar, where the
 * skip amount and speed pickers live alongside audio and subtitles.
 */
@Composable
fun TvPlayerScreen(container: TvContainer, fileId: String, itemId: String, startMs: Long, playNext: (String, String) -> Unit, back: () -> Unit) {
    val items = container.items() ?: return
    val client = container.client() ?: return
    val context = LocalContext.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val settings by container.playerPrefs.settings.collectAsState()

    var detail by remember { mutableStateOf<ItemDetail?>(null) }
    var file by remember { mutableStateOf<MediaFile?>(null) }
    var decision by remember { mutableStateOf<PlaybackDecision?>(null) }
    var audioIndex by remember { mutableStateOf<Int?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var controlsVisible by remember { mutableStateOf(false) }
    var lastInteraction by remember { mutableStateOf(System.currentTimeMillis()) }
    var picker by remember { mutableStateOf<Picker?>(null) }
    var resumeAt by remember { mutableStateOf(startMs) }
    var nextEpisode by remember { mutableStateOf<Pair<String, String>?>(null) }
    var countdown by remember { mutableStateOf<Int?>(null) }

    val player = remember { ProjektorPlayer(context, onProgress = { pos, dur -> runCatching { items.reportProgress(itemId, pos, dur) } }) }
    val state by player.state.collectAsState()
    val rootFocus = remember { FocusRequester() }
    val toggleFocus = remember { FocusRequester() }
    val pickerFocus = remember { FocusRequester() }

    DisposableEffect(Unit) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false; scope.launch { player.release() } }
    }
    LaunchedEffect(itemId) {
        try {
            val d = items.detail(itemId)
            detail = d
            file = d.files.firstOrNull { it.id == fileId } ?: d.files.firstOrNull()
            if (d.kind.value == "episode") runCatching { items.nextEpisode(d.id) }.getOrNull()?.let { n ->
                runCatching { items.detail(n.id) }.getOrNull()?.files?.firstOrNull()?.let { f -> nextEpisode = f.id to n.id }
            }
        } catch (e: Exception) { error = e.userMessage() }
    }
    LaunchedEffect(file, audioIndex) {
        val f = file ?: return@LaunchedEffect
        try {
            val d = items.decide(PlaybackDecideRequestInput(fileId = f.id, profile = DeviceProfiles.current(), audioStreamIndex = audioIndex, startPositionMs = resumeAt.toInt()))
            decision = d
            player.load(mediaSpecFor(d, client), startMs = resumeAt, rate = settings.rate, knownDurationMs = f.durationMs.toLong())
            rootFocus.requestFocus()
        } catch (e: Exception) { error = e.userMessage() }
    }
    LaunchedEffect(settings.rate) { player.setRate(settings.rate) }
    LaunchedEffect(controlsVisible, state.isPlaying, lastInteraction, picker) {
        if (controlsVisible && state.isPlaying && picker == null) {
            delay(4_000)
            if (System.currentTimeMillis() - lastInteraction >= 3_900) { controlsVisible = false; rootFocus.requestFocus() }
        }
    }
    // Auto-play the next episode after a short countdown once this one ends.
    LaunchedEffect(state.ended, nextEpisode) {
        if (state.ended && nextEpisode != null) {
            for (n in 10 downTo 1) { countdown = n; delay(1_000) }
            nextEpisode?.let { (f, i) -> playNext(f, i) }
        } else countdown = null
    }

    fun touched() { lastInteraction = System.currentTimeMillis() }
    fun showControls() { touched(); if (!controlsVisible) { controlsVisible = true; scope.launch { delay(50); runCatching { toggleFocus.requestFocus() } } } }
    fun skip(direction: Int) { player.skip(direction * settings.skipMs); touched() }

    BackHandler {
        when {
            picker != null -> { picker = null; scope.launch { delay(50); runCatching { toggleFocus.requestFocus() } } }
            controlsVisible -> { controlsVisible = false; rootFocus.requestFocus() }
            else -> back()
        }
    }

    Box(
        Modifier.fillMaxSize().background(Color.Black)
            .focusRequester(rootFocus).focusable()
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                val code = event.nativeKeyEvent.keyCode
                // Media keys work whatever has focus.
                when (code) {
                    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> { player.togglePlayPause(); touched(); return@onPreviewKeyEvent true }
                    KeyEvent.KEYCODE_MEDIA_PLAY -> { player.play(); touched(); return@onPreviewKeyEvent true }
                    KeyEvent.KEYCODE_MEDIA_PAUSE -> { player.pause(); showControls(); return@onPreviewKeyEvent true }
                    KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, KeyEvent.KEYCODE_MEDIA_NEXT -> { skip(1); return@onPreviewKeyEvent true }
                    KeyEvent.KEYCODE_MEDIA_REWIND, KeyEvent.KEYCODE_MEDIA_PREVIOUS -> { skip(-1); return@onPreviewKeyEvent true }
                }
                if (controlsVisible || picker != null) return@onPreviewKeyEvent false
                when (code) {
                    KeyEvent.KEYCODE_DPAD_RIGHT -> { skip(1); true }
                    KeyEvent.KEYCODE_DPAD_LEFT -> { skip(-1); true }
                    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> { player.togglePlayPause(); showControls(); true }
                    KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN -> { showControls(); true }
                    else -> false
                }
            },
    ) {
        AndroidView(factory = { ctx -> PlayerView(ctx).apply { useController = false; this.player = player.exo } }, modifier = Modifier.fillMaxSize())
        Text(state.positionMs.toString(), Modifier.width(1.dp).height(1.dp).testTag("position-ms"), color = Color.Transparent)
        error?.let { Text(it, Modifier.align(Alignment.Center).padding(32.dp), color = MaterialTheme.colorScheme.error) }
        if (state.isBuffering && error == null) Text("…", Modifier.align(Alignment.Center), style = MaterialTheme.typography.displayMedium)
        if (state.ended && nextEpisode != null) {
            val nextFocus = remember { FocusRequester() }
            LaunchedEffect(Unit) { runCatching { nextFocus.requestFocus() } }
            Button(onClick = { nextEpisode?.let { (f, i) -> playNext(f, i) } }, modifier = Modifier.align(Alignment.Center).focusRequester(nextFocus).testTag("next-episode")) {
                Text("Play next episode${countdown?.let { " ($it)" } ?: ""}")
            }
        }
        // Skip feedback flash: brief label near the bottom when jumping with controls hidden.
        if (controlsVisible || picker != null) {
            Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().background(Color.Black.copy(alpha = 0.7f)).padding(horizontal = 40.dp, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(detail?.let { d -> if (d.kind.value == "episode") "${d.showTitle ?: ""} · ${d.title}" else d.title } ?: "", style = MaterialTheme.typography.titleLarge)
                decision?.let { Text(badge(it), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("decision")) }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(formatMs(state.positionMs), style = MaterialTheme.typography.labelLarge)
                    Box(Modifier.weight(1f).height(6.dp).background(MaterialTheme.colorScheme.surfaceVariant)) {
                        val frac = if (state.durationMs > 0) (state.positionMs.toFloat() / state.durationMs).coerceIn(0f, 1f) else 0f
                        Box(Modifier.fillMaxWidth(frac).fillMaxHeight().background(MaterialTheme.colorScheme.primary))
                    }
                    Text(formatMs(state.durationMs), style = MaterialTheme.typography.labelLarge)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Button(onClick = { skip(-1) }, modifier = Modifier.testTag("skip-back")) { Text("↺ ${settings.skipSeconds}s") }
                    Button(onClick = { player.togglePlayPause(); touched() }, modifier = Modifier.focusRequester(toggleFocus).testTag("toggle")) { Text(if (state.isPlaying) "Pause" else "Play") }
                    Button(onClick = { skip(1) }, modifier = Modifier.testTag("skip-forward")) { Text("${settings.skipSeconds}s ↻") }
                    Button(onClick = { picker = Picker.SKIP; touched() }, modifier = Modifier.testTag("skip-select")) { Text("Skip +${settings.skipSeconds}s") }
                    Button(onClick = { picker = Picker.SPEED; touched() }, modifier = Modifier.testTag("speed-select")) { Text("Speed ${formatRate(settings.rate)}") }
                    val audioTracks = file?.streams?.filter { it.type.value == "audio" }.orEmpty()
                    if (audioTracks.size > 1) Button(onClick = { picker = Picker.AUDIO; touched() }, modifier = Modifier.testTag("audio-select")) { Text("Audio") }
                    if (state.subtitleTracks.isNotEmpty()) Button(onClick = { picker = Picker.SUBTITLES; touched() }, modifier = Modifier.testTag("subtitle-select")) { Text("Subtitles") }
                }
            }
        }
        picker?.let { which ->
            val audioTracks = file?.streams?.filter { it.type.value == "audio" }.orEmpty()
            val options: List<Pair<String, () -> Unit>> = when (which) {
                Picker.SKIP -> SKIP_OPTIONS.map { n -> "+${n}s" to { container.playerPrefs.update(skipSeconds = n) } }
                Picker.SPEED -> RATE_OPTIONS.map { r -> formatRate(r) to { container.playerPrefs.update(rate = r) } }
                Picker.AUDIO -> audioTracks.map { t -> "${t.title ?: t.language ?: "Track ${t.index}"} (${t.codec})" to { resumeAt = state.positionMs; audioIndex = t.index } }
                Picker.SUBTITLES -> listOf<Pair<String, () -> Unit>>("Off" to { player.selectSubtitle(null) }) + state.subtitleTracks.map { t -> t.label to { player.selectSubtitle(t.id) } }
            }
            LaunchedEffect(which) { delay(50); runCatching { pickerFocus.requestFocus() } }
            Column(
                Modifier.align(Alignment.CenterEnd).fillMaxHeight().width(360.dp).background(Color.Black.copy(alpha = 0.85f)).padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(when (which) { Picker.SKIP -> "Skip amount"; Picker.SPEED -> "Speed"; Picker.AUDIO -> "Audio"; Picker.SUBTITLES -> "Subtitles" }, style = MaterialTheme.typography.titleLarge)
                options.forEachIndexed { i, (label, apply) ->
                    Button(
                        onClick = { apply(); picker = null; touched(); scope.launch { delay(50); runCatching { toggleFocus.requestFocus() } } },
                        modifier = Modifier.fillMaxWidth().testTag("option-$label").let { if (i == 0) it.focusRequester(pickerFocus) else it },
                    ) { Text(label) }
                }
            }
        }
    }
}

private fun badge(d: PlaybackDecision): String = when (d.method) {
    PlaybackMethod.DIRECT -> "Direct play"
    PlaybackMethod.REMUX -> "Remux"
    PlaybackMethod.TRANSCODE -> "Transcoding"
}
