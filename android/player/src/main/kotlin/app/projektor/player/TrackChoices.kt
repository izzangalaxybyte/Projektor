package app.projektor.player

import app.projektor.core.api.models.PlaybackDecision
import app.projektor.core.api.models.SubtitleTrack

/**
 * Whether a player subtitle track is this server subtitle: sideloaded tracks (direct play) carry
 * its id, HLS ones (remux and transcode) only the name the server gave them.
 */
fun SubtitleTrack.isShownBy(option: TrackOption): Boolean =
    option.id == id || option.id.endsWith(":$id") || option.label == (title ?: language ?: format).replace('"', '\'')

/** The server subtitle behind a player track, to remember the pick for the show. */
fun PlaybackDecision.subtitleFor(option: TrackOption): SubtitleTrack? = subtitles.firstOrNull { it.isShownBy(option) }

/**
 * Turns on the subtitle last picked for the show (or turns subtitles off). Returns false while the
 * player has no subtitle tracks yet, so the caller tries again once they appear.
 */
fun ProjektorPlayer.applyRememberedSubtitle(decision: PlaybackDecision, tracks: List<TrackOption>): Boolean {
    if (tracks.isEmpty()) return false
    when {
        decision.subtitlesOff -> selectSubtitle(null)
        decision.preferredSubtitleId != null -> {
            val wanted = decision.subtitles.firstOrNull { it.id == decision.preferredSubtitleId } ?: return true
            tracks.firstOrNull { wanted.isShownBy(it) }?.let { selectSubtitle(it.id) }
        }
    }
    return true
}
