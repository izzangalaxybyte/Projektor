package app.projektor.mobile.ui.player

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import app.projektor.core.ProjektorClient
import coil3.compose.AsyncImage
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material.icons.filled.Forward30
import androidx.compose.material.icons.filled.Replay30
import androidx.compose.material.icons.filled.SkipNext
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
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.ui.PlayerView
import app.projektor.player.liftSubtitles
import app.projektor.player.showWithStackedSubtitles
import app.projektor.core.api.models.ItemDetail
import app.projektor.core.api.models.LibraryKind
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
import app.projektor.player.subtitleFor
import app.projektor.player.applyRememberedSubtitle
import app.projektor.player.TrackOption
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.delay

/**
 * Fullscreen playback. The on-screen buttons jump a fixed 10 or 30 seconds (and 90 for anime, to
 * get past an opening); double taps on the outer 40% of either side jump forward by the amount chosen
 * in the bottom bar, and a double tap in the middle fifth plays/pauses. The amount and speed persist.
 */
@Composable
fun PlayerScreen(container: AppContainer, fileId: String, itemId: String, startMs: Long, playNext: (fileId: String, itemId: String) -> Unit, back: () -> Unit) {
    val items = container.items() ?: return
    val client = container.client() ?: return
    val context = LocalContext.current
    val settings by container.playerPrefs.settings.collectAsState()

    var detail by remember { mutableStateOf<ItemDetail?>(null) }
    var file by remember { mutableStateOf<MediaFile?>(null) }
    val scope = rememberCoroutineScope()
    var decision by remember { mutableStateOf<PlaybackDecision?>(null) }
    var audioIndex by remember { mutableStateOf<Long?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var controlsVisible by remember { mutableStateOf(true) }
    // Height of the bottom bar while it shows; subtitles move up out of its way.
    var bottomBarPx by remember { mutableStateOf(0) }
    var lastInteraction by remember { mutableStateOf(System.currentTimeMillis()) }
    var resumeAt by remember { mutableStateOf(startMs) }
    var nextEpisode by remember { mutableStateOf<Pair<String, String>?>(null) }
    var nextDetail by remember { mutableStateOf<ItemDetail?>(null) }

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
                    runCatching { items.detail(n.id) }.getOrNull()?.let { nd ->
                        closestVersion(file?.fileName, nd.files)?.let { f -> nextEpisode = f.id to n.id; nextDetail = nd }
                    }
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
            // Direct play keeps every audio track; pin the chosen one, the one remembered for the
            // show, or the server's default pick.
            val audio = f.streams.filter { it.type.value == "audio" }
            val chosen = audioIndex ?: d.audioStreamIndex
            val wanted = audio.indexOfFirst { it.index == chosen }.takeIf { it >= 0 }
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
    // Turn on the subtitle remembered for the show once the player lists its tracks.
    var subtitleApplied by remember(decision) { mutableStateOf(false) }
    LaunchedEffect(decision, state.subtitleTracks) {
        val d = decision ?: return@LaunchedEffect
        if (!subtitleApplied) subtitleApplied = player.applyRememberedSubtitle(d, state.subtitleTracks)
    }
    // Picks are remembered for the show, so its other episodes start with the same tracks.
    fun rememberChoice(audio: Long? = null, subtitle: TrackOption? = null, off: Boolean = false) {
        val f = file ?: return
        val subtitleId = subtitle?.let { decision?.subtitleFor(it)?.id }
        if (audio == null && subtitleId == null && !off) return
        scope.launch { runCatching { items.rememberTrackChoice(f.id, audio, subtitleId, off.takeIf { it }) } }
    }
    // Holding the screen plays at the hold speed until it's let go.
    var boosting by remember { mutableStateOf(false) }
    LaunchedEffect(settings.rate, settings.holdRate, boosting) { player.setRate(if (boosting) settings.holdRate else settings.rate) }

    // Auto-hide controls while playing.
    // Controls stay up while a picker's menu is open.
    var menuOpen by remember { mutableStateOf(false) }
    LaunchedEffect(controlsVisible, state.isPlaying, lastInteraction, menuOpen) {
        if (controlsVisible && state.isPlaying && !menuOpen) {
            delay(3_500)
            if (System.currentTimeMillis() - lastInteraction >= 3_400) controlsVisible = false
        }
    }
    fun touched() { lastInteraction = System.currentTimeMillis(); controlsVisible = true }
    // Double taps seek without bringing the controls up; while they're up, any skip keeps them there.
    fun skip(deltaMs: Long) { player.skip(deltaMs); if (controlsVisible) touched() }
    fun playNextEpisode() { nextEpisode?.let { (f, i) -> playNext(f, i) } }
    fun exit() { player.pause(); back() }

    BackHandler { exit() }

    Box(
        Modifier.fillMaxSize().background(Color.Black).pointerInput(settings.skipSeconds) {
            detectTapGestures(
                onTap = { if (controlsVisible) controlsVisible = false else touched() },
                onDoubleTap = { offset ->
                    // Either side skips forward (reachable with whichever thumb); the middle plays/pauses.
                    if (offset.x < size.width * 0.4f || offset.x > size.width * 0.6f) skip(settings.skipMs)
                    else { player.togglePlayPause(); if (controlsVisible) touched() }
                },
                onLongPress = { if (state.isPlaying) boosting = true },
                onPress = { tryAwaitRelease(); boosting = false },
            )
        },
    ) {
        val chromeShown = controlsVisible || state.isPaused
        AndroidView(
            factory = { ctx -> PlayerView(ctx).apply { useController = false; showWithStackedSubtitles(player) } },
            update = { it.liftSubtitles(if (chromeShown) bottomBarPx else 0) },
            modifier = Modifier.fillMaxSize(),
        )
        // Hidden probes for tests: position in ms and current rate.
        Text(state.positionMs.toString(), Modifier.size(1.dp).testTag("position-ms"), color = Color.Transparent)
        Text(settings.rate.toString(), Modifier.size(1.dp).testTag("rate"), color = Color.Transparent)

        if (state.isBuffering && error == null) CircularProgressIndicator(Modifier.align(Alignment.Center))
        error?.let { Text(it, Modifier.align(Alignment.Center).padding(24.dp), color = MaterialTheme.colorScheme.error) }
        if (boosting) SpeedBoostBadge(settings.holdRate, Modifier.align(Alignment.TopCenter).padding(top = 24.dp))
        // At the end only the way on to the next episode is offered, not the transport.
        val showNextOnly = state.ended && nextEpisode != null
        if (showNextOnly) PlayerChrome {
            UpNext(client, nextDetail, ::playNextEpisode, Modifier.align(Alignment.Center))
        }

        if (chromeShown) PlayerChrome {
            // Top bar
            Row(Modifier.align(Alignment.TopStart).fillMaxWidth().then(TopScrim).padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 24.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = ::exit, modifier = Modifier.testTag("back")) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                Column(Modifier.weight(1f)) {
                    Text(detail?.let { d -> if (d.kind.value == "episode") listOfNotNull(d.showTitle, episodeCode(d), d.title).joinToString(" · ") else d.title } ?: "", style = MaterialTheme.typography.titleMedium)
                    decision?.let { Text(badge(it), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("decision")) }
                }
            }
            // Center transport: -30 · -10 · play/pause · +10 · +30
            if (!showNextOnly) Row(Modifier.align(Alignment.Center), horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically) {
                SkipButton(Icons.Filled.Replay30, "Skip back 30 seconds", "skip-back-30") { skip(-30_000) }
                SkipButton(Icons.Filled.Replay10, "Skip back 10 seconds", "skip-back-10") { skip(-10_000) }
                IconButton(onClick = { player.togglePlayPause(); touched() }, modifier = Modifier.size(80.dp).then(ButtonScrim).testTag("toggle").semantics { contentDescription = if (state.isPlaying) "Pause" else "Play" }) {
                    Icon(if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, null, Modifier.size(56.dp))
                }
                SkipButton(Icons.Filled.Forward10, "Skip forward 10 seconds", "skip-forward-10") { skip(10_000) }
                SkipButton(Icons.Filled.Forward30, "Skip forward 30 seconds", "skip-forward-30") { skip(30_000) }
            }
            // Anime: one tap past the opening.
            if (!showNextOnly && detail?.libraryKind == LibraryKind.ANIME) {
                OutlinedButton(
                    onClick = { skip(90_000) },
                    shape = CircleShape,
                    contentPadding = PaddingValues(0.dp),
                    modifier = Modifier.align(Alignment.CenterEnd).padding(end = 24.dp).size(64.dp).then(ButtonScrim).testTag("skip-forward-90").semantics { contentDescription = "Skip forward 90 seconds" },
                ) { Text("+90", style = MaterialTheme.typography.titleMedium, color = Color.White) }
            }
            // Bottom bar
            Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().onSizeChanged { bottomBarPx = it.height }.then(BottomScrim).padding(start = 12.dp, end = 12.dp, top = 24.dp, bottom = 8.dp)) {
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
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Picker(
                        label = "Double tap ${settings.skipSeconds}s",
                        options = SKIP_OPTIONS.map { it to "+${it}s" },
                        onPick = { container.playerPrefs.update(skipSeconds = it); touched() },
                        tag = "skip-select", onOpenChange = { menuOpen = it; if (!it) touched() },
                    )
                    Picker(
                        label = formatRate(settings.rate),
                        options = RATE_OPTIONS.map { it to formatRate(it) },
                        onPick = { container.playerPrefs.update(rate = it); touched() },
                        tag = "speed-select", onOpenChange = { menuOpen = it; if (!it) touched() },
                    )
                    Picker(
                        label = "Hold ${formatRate(settings.holdRate)}",
                        options = HOLD_RATE_OPTIONS.map { it to formatRate(it) },
                        onPick = { container.playerPrefs.update(holdRate = it); touched() },
                        tag = "hold-speed-select", onOpenChange = { menuOpen = it; if (!it) touched() },
                    )
                    val audioTracks = file?.streams?.filter { it.type.value == "audio" }.orEmpty()
                    if (audioTracks.size > 1) {
                        val current = audioTracks.firstOrNull { it.index == (audioIndex ?: decision?.audioStreamIndex) } ?: audioTracks.firstOrNull { it.isDefault } ?: audioTracks.first()
                        Picker(
                            label = "Audio: ${current.title ?: current.language ?: current.index}",
                            options = audioTracks.map { it.index to "${it.title ?: it.language ?: "Track ${it.index}"} (${it.codec})" },
                            onPick = { resumeAt = state.positionMs; audioIndex = it; rememberChoice(audio = it); touched() },
                            tag = "audio-select", onOpenChange = { menuOpen = it; if (!it) touched() },
                        )
                    }
                    if (state.subtitleTracks.isNotEmpty()) {
                        val current = state.subtitleTracks.firstOrNull { it.id == state.selectedSubtitle }
                        Picker(
                            label = "Subtitles: ${current?.label ?: "off"}",
                            options = listOf<Pair<String?, String>>(null to "Off") + state.subtitleTracks.map { it.id to it.label },
                            onPick = { id ->
                                player.selectSubtitle(id)
                                rememberChoice(subtitle = state.subtitleTracks.firstOrNull { it.id == id }, off = id == null)
                                touched()
                            },
                            tag = "subtitle-select", onOpenChange = { menuOpen = it; if (!it) touched() },
                        )
                    }
                    Spacer(Modifier.width(4.dp))
                }
                if (nextEpisode != null) {
                    OutlinedButton(onClick = ::playNextEpisode, modifier = Modifier.testTag("next-episode-bar")) {
                        Text("Next episode", style = MaterialTheme.typography.labelMedium)
                        Spacer(Modifier.width(4.dp))
                        Icon(Icons.Filled.SkipNext, null, Modifier.size(18.dp))
                    }
                }
                }
            }
        }
    }
}

private fun episodeCode(d: ItemDetail): String? =
    listOfNotNull(d.seasonNumber?.let { "S$it" }, d.episodeNumber?.let { "E$it" }).joinToString(" ").ifEmpty { null }

/** Shown when an episode ends: what's next, with the button to play it. */
@Composable
private fun UpNext(client: ProjektorClient, next: ItemDetail?, play: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.padding(24.dp).widthIn(max = 560.dp).background(Color.Black.copy(alpha = 0.75f), RoundedCornerShape(12.dp)).padding(16.dp).testTag("up-next"),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        client.imageUrl(next?.posterKey, 780)?.let { url ->
            AsyncImage(url, null, Modifier.width(180.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(8.dp)), contentScale = ContentScale.Crop)
        }
        Column(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Up next", style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.7f))
            if (next != null) {
                Text(listOfNotNull(episodeCode(next), next.title).joinToString(" · "), style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                next.overview?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.8f), maxLines = 3, overflow = TextOverflow.Ellipsis) }
            }
            Button(onClick = play, modifier = Modifier.padding(top = 8.dp).testTag("next-episode")) {
                Icon(Icons.Filled.PlayArrow, null, Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("Play next episode")
            }
        }
    }
}

@Composable
private fun SkipButton(icon: ImageVector, description: String, tag: String, onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.size(56.dp).then(ButtonScrim).testTag(tag).semantics { contentDescription = description }) {
        Icon(icon, null, Modifier.size(36.dp))
    }
}

@Composable
internal fun <T> Picker(label: String, options: List<Pair<T, String>>, onPick: (T) -> Unit, tag: String, onOpenChange: (Boolean) -> Unit = {}) {
    var open by remember { mutableStateOf(false) }
    fun setOpen(value: Boolean) { open = value; onOpenChange(value) }
    Box {
        OutlinedButton(onClick = { setOpen(true) }, modifier = Modifier.testTag(tag)) { Text(label, style = MaterialTheme.typography.labelMedium) }
        DropdownMenu(expanded = open, onDismissRequest = { setOpen(false) }) {
            options.forEach { (value, text) ->
                DropdownMenuItem(text = { Text(text) }, onClick = { setOpen(false); onPick(value) }, modifier = Modifier.testTag("$tag-$text"))
            }
        }
    }
}

private fun badge(d: PlaybackDecision): String = when (d.method) {
    PlaybackMethod.DIRECT -> "Direct play"
    PlaybackMethod.REMUX -> "Remux"
    PlaybackMethod.TRANSCODE -> "Transcoding"
}
