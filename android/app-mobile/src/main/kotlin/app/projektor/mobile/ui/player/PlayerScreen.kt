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
import coil3.compose.AsyncImage
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AspectRatio
import androidx.compose.material.icons.filled.DashboardCustomize
import androidx.compose.material.icons.filled.FitScreen
import androidx.compose.material.icons.filled.Forward5
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.Replay5
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material3.FilledTonalButton
import androidx.compose.runtime.key
import androidx.media3.ui.AspectRatioFrameLayout
import app.projektor.core.playback.PlayerControl
import app.projektor.core.playback.PlayerZone
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
 * Which controls show and where is the user's own layout, edited from the top bar's customize button.
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
    var nextImage by remember { mutableStateOf<String?>(null) }
    // A downloaded file plays from the phone, with no server needed.
    val downloads = container.downloads
    val local = remember(fileId) { downloads.playable(fileId) }

    val player = remember {
        ProjektorPlayer(context, onProgress = { pos, dur ->
            downloads.savePosition(itemId, pos)
            runCatching { items.reportProgress(itemId, pos, dur) }
        })
    }
    val state by player.state.collectAsState()

    PlayerWindow(player)

    suspend fun findNextOnServer(d: ItemDetail) {
        runCatching { items.nextEpisode(d.id) }.getOrNull()?.let { n ->
            // Keep to the release being watched when the next episode has several files.
            runCatching { items.detail(n.id) }.getOrNull()?.let { nd ->
                closestVersion(file?.fileName, nd.files)?.let { f ->
                    nextEpisode = f.id to n.id; nextDetail = nd; nextImage = client.imageUrl(nd.posterKey, 780)
                }
            }
        }
    }
    // Load detail once, then decide (again whenever the audio track changes).
    LaunchedEffect(itemId) {
        if (local != null) {
            detail = local.detail
            file = local.file
            // Up next is the next downloaded episode; failing that, the server's, when it can be reached.
            val n = downloads.nextAfter(local)
            if (n != null) { nextEpisode = n.file.id to n.itemId; nextDetail = n.detail; nextImage = downloads.imageOf(n) }
            else if (local.isEpisode) findNextOnServer(local.detail)
            return@LaunchedEffect
        }
        try {
            val d = items.detail(itemId)
            detail = d
            file = d.files.firstOrNull { it.id == fileId } ?: d.files.firstOrNull()
            if (d.kind.value == "episode") findNextOnServer(d)
        } catch (e: Exception) { error = e.userMessage() }
    }
    LaunchedEffect(file, audioIndex) {
        val f = file ?: return@LaunchedEffect
        if (local != null) {
            val audio = f.streams.filter { it.type.value == "audio" }
            val wanted = audio.indexOfFirst { it.index == audioIndex }.takeIf { it >= 0 }
                ?: audio.indexOfFirst { it.isDefault }.takeIf { it >= 0 } ?: 0
            player.load(downloads.mediaSpec(local), startMs = resumeAt, rate = settings.rate, knownDurationMs = f.durationMs.toLong(), audioOrdinal = wanted.takeIf { audio.size > 1 })
            return@LaunchedEffect
        }
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
    var customizing by remember { mutableStateOf(false) }
    var locked by remember { mutableStateOf(false) }
    LaunchedEffect(controlsVisible, state.isPlaying, lastInteraction, menuOpen, locked) {
        if (controlsVisible && (state.isPlaying || locked) && !menuOpen) {
            delay(3_500)
            if (System.currentTimeMillis() - lastInteraction >= 3_400) controlsVisible = false
        }
    }
    fun touched() { lastInteraction = System.currentTimeMillis(); controlsVisible = true }
    // Double taps seek without bringing the controls up; while they're up, any skip keeps them there.
    fun skip(deltaMs: Long) { player.skip(deltaMs); if (controlsVisible) touched() }
    fun playNextEpisode() { nextEpisode?.let { (f, i) -> playNext(f, i) } }
    fun exit() { player.pause(); back() }

    val layout by container.playerPrefs.layout.collectAsState()
    // Fill crops the picture to the screen instead of fitting it with bars.
    var fill by remember { mutableStateOf(false) }
    val pickerOpen = { open: Boolean -> menuOpen = open; if (!open) touched() }

    /** One control, sized for where it sits: larger in the middle and down the edges than in the bars. */
    @Composable
    fun Control(c: PlayerControl, zone: PlayerZone) {
        val inBar = zone in setOf(PlayerZone.TOP_START, PlayerZone.TOP_END, PlayerZone.BOTTOM_START, PlayerZone.BOTTOM_END)
        val skipSize = if (inBar) 44.dp else 56.dp
        val skipIcon = if (inBar) 28.dp else 36.dp
        fun skipButton(icon: ImageVector, description: String, tag: String, onClick: () -> Unit): @Composable () -> Unit = {
            IconButton(onClick = onClick, modifier = Modifier.size(skipSize).then(if (inBar) Modifier else ButtonScrim).testTag(tag).semantics { contentDescription = description }) {
                Icon(icon, null, Modifier.size(skipIcon))
            }
        }
        when (c) {
            PlayerControl.BACK -> IconButton(onClick = ::exit, modifier = Modifier.testTag("back")) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            PlayerControl.PLAY_PAUSE -> {
                val big = zone == PlayerZone.CENTER
                IconButton(onClick = { player.togglePlayPause(); touched() }, modifier = Modifier.size(if (big) 80.dp else skipSize).then(ButtonScrim).testTag("toggle").semantics { contentDescription = if (state.isPlaying) "Pause" else "Play" }) {
                    Icon(if (state.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, null, Modifier.size(if (big) 56.dp else skipIcon))
                }
            }
            PlayerControl.REPLAY_30 -> skipButton(Icons.Filled.Replay30, "Skip back 30 seconds", "skip-back-30") { skip(-30_000) }()
            PlayerControl.REPLAY_10 -> skipButton(Icons.Filled.Replay10, "Skip back 10 seconds", "skip-back-10") { skip(-10_000) }()
            PlayerControl.REPLAY_5 -> skipButton(Icons.Filled.Replay5, "Skip back 5 seconds", "skip-back-5") { skip(-5_000) }()
            PlayerControl.FORWARD_5 -> skipButton(Icons.Filled.Forward5, "Skip forward 5 seconds", "skip-forward-5") { skip(5_000) }()
            PlayerControl.FORWARD_10 -> skipButton(Icons.Filled.Forward10, "Skip forward 10 seconds", "skip-forward-10") { skip(10_000) }()
            PlayerControl.FORWARD_30 -> skipButton(Icons.Filled.Forward30, "Skip forward 30 seconds", "skip-forward-30") { skip(30_000) }()
            PlayerControl.RESTART -> skipButton(Icons.Filled.RestartAlt, "Start over", "restart") { player.seekTo(0); touched() }()
            PlayerControl.FIT -> skipButton(if (fill) Icons.Filled.FitScreen else Icons.Filled.AspectRatio, if (fill) "Fit to screen" else "Fill screen", "fit") { fill = !fill; touched() }()
            PlayerControl.LOCK -> skipButton(Icons.Filled.Lock, "Lock screen", "lock") { locked = true; controlsVisible = false }()
            // Anime: one tap past the opening.
            PlayerControl.SKIP_90 -> if (detail?.libraryKind == LibraryKind.ANIME) OutlinedButton(
                onClick = { skip(90_000) },
                shape = CircleShape,
                contentPadding = PaddingValues(0.dp),
                modifier = Modifier.size(if (inBar) 44.dp else 64.dp).then(ButtonScrim).testTag("skip-forward-90").semantics { contentDescription = "Skip forward 90 seconds" },
            ) { Text("+90", style = if (inBar) MaterialTheme.typography.labelLarge else MaterialTheme.typography.titleMedium, color = Color.White) }
            PlayerControl.DOUBLE_TAP -> Picker(
                label = "Double tap ${settings.skipSeconds}s",
                options = SKIP_OPTIONS.map { it to "+${it}s" },
                onPick = { container.playerPrefs.update(skipSeconds = it); touched() },
                tag = "skip-select", onOpenChange = pickerOpen,
            )
            PlayerControl.SPEED -> Picker(
                label = formatRate(settings.rate),
                options = RATE_OPTIONS.map { it to formatRate(it) },
                onPick = { container.playerPrefs.update(rate = it); touched() },
                tag = "speed-select", onOpenChange = pickerOpen,
            )
            PlayerControl.HOLD_SPEED -> Picker(
                label = "Hold ${formatRate(settings.holdRate)}",
                options = HOLD_RATE_OPTIONS.map { it to formatRate(it) },
                onPick = { container.playerPrefs.update(holdRate = it); touched() },
                tag = "hold-speed-select", onOpenChange = pickerOpen,
            )
            PlayerControl.AUDIO -> {
                val audioTracks = file?.streams?.filter { it.type.value == "audio" }.orEmpty()
                if (audioTracks.size > 1) {
                    val current = audioTracks.firstOrNull { it.index == (audioIndex ?: decision?.audioStreamIndex) } ?: audioTracks.firstOrNull { it.isDefault } ?: audioTracks.first()
                    Picker(
                        label = "Audio: ${current.title ?: current.language ?: current.index}",
                        options = audioTracks.map { it.index to "${it.title ?: it.language ?: "Track ${it.index}"} (${it.codec})" },
                        onPick = { resumeAt = state.positionMs; audioIndex = it; rememberChoice(audio = it); touched() },
                        tag = "audio-select", onOpenChange = pickerOpen,
                    )
                }
            }
            PlayerControl.SUBTITLES -> if (state.subtitleTracks.isNotEmpty()) {
                val current = state.subtitleTracks.firstOrNull { it.id == state.selectedSubtitle }
                Picker(
                    label = "Subtitles: ${current?.label ?: "off"}",
                    options = listOf<Pair<String?, String>>(null to "Off") + state.subtitleTracks.map { it.id to it.label },
                    onPick = { id ->
                        player.selectSubtitle(id)
                        rememberChoice(subtitle = state.subtitleTracks.firstOrNull { it.id == id }, off = id == null)
                        touched()
                    },
                    tag = "subtitle-select", onOpenChange = pickerOpen,
                )
            }
            PlayerControl.NEXT_EPISODE -> if (nextEpisode != null) {
                OutlinedButton(onClick = ::playNextEpisode, modifier = Modifier.testTag("next-episode-bar")) {
                    Text("Next episode", style = MaterialTheme.typography.labelMedium)
                    Spacer(Modifier.width(4.dp))
                    Icon(Icons.Filled.SkipNext, null, Modifier.size(18.dp))
                }
            }
        }
    }

    BackHandler { exit() }

    Box(
        Modifier.fillMaxSize().background(Color.Black).pointerInput(settings.skipSeconds, locked, customizing) {
            if (customizing) return@pointerInput
            if (locked) { detectTapGestures(onTap = { if (controlsVisible) controlsVisible = false else touched() }); return@pointerInput }
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
        val chromeShown = (controlsVisible || state.isPaused) && !locked && !customizing
        AndroidView(
            factory = { ctx -> PlayerView(ctx).apply { useController = false; showWithStackedSubtitles(player) } },
            update = {
                it.liftSubtitles(if (chromeShown) bottomBarPx else 0)
                it.resizeMode = if (fill) AspectRatioFrameLayout.RESIZE_MODE_ZOOM else AspectRatioFrameLayout.RESIZE_MODE_FIT
            },
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
        if (showNextOnly && !customizing) PlayerChrome {
            UpNext(nextImage, nextDetail, ::playNextEpisode, Modifier.align(Alignment.Center))
        }

        if (chromeShown) PlayerChrome {
            // Top bar: both ends hold whatever was placed there; the title fills the middle.
            Row(Modifier.align(Alignment.TopStart).fillMaxWidth().then(TopScrim).padding(start = 8.dp, end = 8.dp, top = 8.dp, bottom = 24.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                layout.controls(PlayerZone.TOP_START).forEach { key(it) { Control(it, PlayerZone.TOP_START) } }
                Column(Modifier.weight(1f).padding(start = 4.dp)) {
                    Text(detail?.let { d -> if (d.kind.value == "episode") listOfNotNull(d.showTitle, episodeCode(d), d.title).joinToString(" · ") else d.title } ?: "", style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    (decision?.let(::badge) ?: "Downloaded".takeIf { local != null })?.let {
                        Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("decision"))
                    }
                }
                layout.controls(PlayerZone.TOP_END).forEach { key(it) { Control(it, PlayerZone.TOP_END) } }
                IconButton(onClick = { player.pause(); customizing = true }, modifier = Modifier.testTag("customize-player")) { Icon(Icons.Filled.DashboardCustomize, "Customize player") }
            }
            if (!showNextOnly) {
                Row(Modifier.align(Alignment.Center), horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically) {
                    layout.controls(PlayerZone.CENTER).forEach { key(it) { Control(it, PlayerZone.CENTER) } }
                }
                Column(Modifier.align(Alignment.CenterStart).padding(start = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    layout.controls(PlayerZone.LEFT).forEach { key(it) { Control(it, PlayerZone.LEFT) } }
                }
                Column(Modifier.align(Alignment.CenterEnd).padding(end = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    layout.controls(PlayerZone.RIGHT).forEach { key(it) { Control(it, PlayerZone.RIGHT) } }
                }
            }
            // Bottom bar: the seek bar stays put; the row under it holds the two bottom zones.
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
                val bottomStart = layout.controls(PlayerZone.BOTTOM_START)
                val bottomEnd = layout.controls(PlayerZone.BOTTOM_END)
                if (bottomStart.isNotEmpty() || bottomEnd.isNotEmpty()) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        bottomStart.forEach { key(it) { Control(it, PlayerZone.BOTTOM_START) } }
                        Spacer(Modifier.width(4.dp))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        bottomEnd.forEach { key(it) { Control(it, PlayerZone.BOTTOM_END) } }
                    }
                }
            }
        }
        // Locked: the screen ignores touches except to bring up the way to unlock it.
        if (locked && controlsVisible) PlayerChrome {
            FilledTonalButton(onClick = { locked = false; touched() }, modifier = Modifier.align(Alignment.Center).testTag("unlock")) {
                Icon(Icons.Filled.LockOpen, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Unlock")
            }
        }
        if (customizing) PlayerCustomizer(
            initial = layout,
            onSave = { container.playerPrefs.updateLayout(it); customizing = false; touched() },
            onClose = { customizing = false; touched() },
        )
    }
}

private fun episodeCode(d: ItemDetail): String? =
    listOfNotNull(d.seasonNumber?.let { "S$it" }, d.episodeNumber?.let { "E$it" }).joinToString(" ").ifEmpty { null }

/** Shown when an episode ends: what's next, with the button to play it. */
@Composable
private fun UpNext(image: String?, next: ItemDetail?, play: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.padding(24.dp).widthIn(max = 560.dp).background(Color.Black.copy(alpha = 0.75f), RoundedCornerShape(12.dp)).padding(16.dp).testTag("up-next"),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        image?.let { url ->
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
