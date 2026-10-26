package app.projektor.player

import android.content.Context
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.exoplayer.ExoPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import androidx.core.net.toUri

/** Snapshot of playback for the UI. */
data class PlayerState(
    val isPlaying: Boolean = false,
    val isBuffering: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val ended: Boolean = false,
    val error: String? = null,
    val subtitleTracks: List<TrackOption> = emptyList(),
    val selectedSubtitle: String? = null,
)

data class TrackOption(val id: String, val label: String, val language: String?)

/**
 * ExoPlayer behind the same small surface every Projektor client shares: load a media spec,
 * play/pause, seek, skip by the chosen amount, set speed, pick subtitles, and report progress
 * every [progressIntervalMs] and on pause, end, and release.
 */
class ProjektorPlayer(
    context: Context,
    private val onProgress: suspend (positionMs: Long, durationMs: Long) -> Unit = { _, _ -> },
    private val progressIntervalMs: Long = 10_000,
) {
    val exo: ExoPlayer = ExoPlayer.Builder(context).build()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var ticker: Job? = null
    private var knownDurationMs: Long = 0
    private var audioOrdinal: Int? = null
    /** Ids of the server's WebVTT tracks sideloaded with a direct-play file; empty otherwise. */
    private var sideloaded: Set<String> = emptySet()
    private var redirectEmbeddedText = false
    private val _state = MutableStateFlow(PlayerState())
    val state: StateFlow<PlayerState> = _state

    init {
        exo.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                publish()
                if (!isPlaying) scope.launch { report() }
            }
            override fun onPlaybackStateChanged(playbackState: Int) {
                publish()
                if (playbackState == Player.STATE_ENDED) scope.launch { report() }
            }
            override fun onPlayerError(error: PlaybackException) {
                _state.value = _state.value.copy(error = error.errorCodeName)
            }
            override fun onTracksChanged(tracks: Tracks) {
                applyAudioChoice()
                preferSideloadedText()
                publish()
            }
        })
        ticker = scope.launch {
            while (true) {
                delay(500)
                publish()
            }
        }
        scope.launch {
            while (true) {
                delay(progressIntervalMs)
                if (exo.isPlaying) report()
            }
        }
    }

    /** Loads a spec and starts at [startMs] with [rate]. [knownDurationMs] covers EVENT playlists that report no duration. */
    /**
     * Loads a spec and starts at [startMs] with [rate]. [audioOrdinal] is the wanted audio track's
     * position among the file's audio streams; pass it for direct play, where the file keeps all its
     * tracks. Left to itself the player picks among tracks flagged default by the device language,
     * so a file with Japanese and English both flagged played English whatever was chosen.
     */
    fun load(spec: MediaSpec, startMs: Long = 0, rate: Float = 1f, knownDurationMs: Long = 0, audioOrdinal: Int? = null) {
        this.knownDurationMs = knownDurationMs
        this.audioOrdinal = audioOrdinal
        sideloaded = spec.subtitles.map { it.id }.toSet()
        redirectEmbeddedText = sideloaded.isNotEmpty()
        exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_AUDIO).build()
        exo.setMediaItem(spec.toMediaItem(), startMs)
        exo.setPlaybackSpeed(rate)
        exo.prepare()
        exo.playWhenReady = true
        _state.value = PlayerState()
    }

    fun play() { exo.play() }
    fun pause() { exo.pause() }
    fun togglePlayPause() { if (exo.isPlaying) exo.pause() else exo.play() }
    fun seekTo(positionMs: Long) { exo.seekTo(positionMs.coerceIn(0, durationOrKnown().takeIf { it > 0 } ?: positionMs)) }
    /** Jump by exactly the chosen amount, forwards or backwards. */
    fun skip(deltaMs: Long) { seekTo(exo.currentPosition + deltaMs) }
    fun setRate(rate: Float) { exo.setPlaybackSpeed(rate) }

    /** Pins the audio track asked for in [load] once the tracks are known; a no-op after that. */
    private fun applyAudioChoice() {
        val ordinal = audioOrdinal ?: return
        val groups = exo.currentTracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
        if (groups.isEmpty()) return
        audioOrdinal = null
        val group = groups.getOrNull(ordinal) ?: return
        exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
            .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, 0))
            .build()
    }

    /** Selects a subtitle track by id (see [PlayerState.subtitleTracks]), or none. */
    fun selectSubtitle(id: String?) {
        val params = exo.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_TEXT)
        if (id == null) {
            params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        } else {
            params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            textGroups().firstOrNull { trackId(it) == id }?.let { params.setOverrideForType(TrackSelectionOverride(it.mediaTrackGroup, 0)) }
        }
        exo.trackSelectionParameters = params.build()
        publish()
    }

    suspend fun release() {
        report()
        scope.cancel()
        exo.release()
    }

    private suspend fun report() {
        val duration = durationOrKnown()
        if (duration <= 0 || exo.currentPosition <= 0) return
        runCatching { onProgress(exo.currentPosition, duration) }
    }

    private fun durationOrKnown(): Long = exo.duration.takeIf { it != C.TIME_UNSET && it > 0 } ?: knownDurationMs

    /**
     * The subtitle tracks to offer. With a direct-play file that is only the server's WebVTT copies:
     * the file's own text tracks can be zlib-compressed, which Media3's Matroska extractor does not
     * undo, so they showed nothing (ASS) or random glyphs (SRT) under the same names.
     */
    private fun textGroups(): List<Tracks.Group> =
        exo.currentTracks.groups.filter { it.type == C.TRACK_TYPE_TEXT && (sideloaded.isEmpty() || isSideloaded(it)) }

    private fun isSideloaded(group: Tracks.Group): Boolean {
        val id = group.getTrackFormat(0).id ?: return false
        return sideloaded.any { id == it || id.endsWith(":$it") }
    }

    /**
     * The player picks the file's default text track on its own; once tracks are known, swap an
     * embedded pick for the server's copy with the same name (or language), so a default-on
     * subtitle stays on but readable.
     */
    private fun preferSideloadedText() {
        if (!redirectEmbeddedText) return
        val all = exo.currentTracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }
        if (all.none(::isSideloaded)) return
        redirectEmbeddedText = false
        val picked = all.firstOrNull { it.isSelected } ?: return
        if (isSideloaded(picked)) return
        val f = picked.getTrackFormat(0)
        val copies = all.filter(::isSideloaded)
        val match = copies.firstOrNull { it.getTrackFormat(0).label == f.label && f.label != null }
            ?: copies.firstOrNull { it.getTrackFormat(0).language == f.language }
        val params = exo.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_TEXT)
        if (match != null) params.setOverrideForType(TrackSelectionOverride(match.mediaTrackGroup, 0))
        else params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        exo.trackSelectionParameters = params.build()
    }

    private fun trackId(group: Tracks.Group): String {
        val f = group.getTrackFormat(0)
        return f.id ?: "${f.language}:${f.label}"
    }

    private fun publish() {
        val groups = textGroups()
        _state.value = _state.value.copy(
            isPlaying = exo.isPlaying,
            isBuffering = exo.playbackState == Player.STATE_BUFFERING,
            positionMs = exo.currentPosition.coerceAtLeast(0),
            durationMs = durationOrKnown(),
            ended = exo.playbackState == Player.STATE_ENDED,
            subtitleTracks = groups.map { g ->
                val f = g.getTrackFormat(0)
                TrackOption(trackId(g), f.label ?: f.language ?: "Subtitles", f.language)
            },
            selectedSubtitle = groups.firstOrNull { it.isSelected }?.let { trackId(it) },
        )
    }
}

fun MediaSpec.toMediaItem(): MediaItem {
    val builder = MediaItem.Builder().setUri(uri.toUri())
    mimeType?.let { builder.setMimeType(it) }
    if (subtitles.isNotEmpty()) {
        builder.setSubtitleConfigurations(
            subtitles.map { s ->
                MediaItem.SubtitleConfiguration.Builder(s.uri.toUri())
                    .setMimeType(MimeTypes.TEXT_VTT)
                    .setId(s.id)
                    .setLabel(s.label)
                    .apply { s.language?.let { setLanguage(it) } }
                    .build()
            },
        )
    }
    return builder.build()
}
