package app.projektor.player

import app.projektor.core.ProjektorClient
import app.projektor.core.api.models.PlaybackDecision
import app.projektor.core.api.models.PlaybackMethod

/** What to hand ExoPlayer, as plain strings so it can be unit tested without the framework. */
data class MediaSpec(val uri: String, val mimeType: String?, val subtitles: List<SubtitleSpec>) {
    val isHls: Boolean get() = mimeType == MIME_HLS
}

data class SubtitleSpec(val id: String, val uri: String, val language: String?, val label: String)

const val MIME_HLS = "application/x-mpegURL"
const val MIME_VTT = "text/vtt"

/**
 * Direct play streams the file with sideloaded WebVTT tracks; remux and transcode point at the
 * HLS master, whose subtitle renditions the server already lists (and token-tags) itself.
 */
fun mediaSpecFor(decision: PlaybackDecision, client: ProjektorClient): MediaSpec {
    val uri = client.withAccessToken(decision.url)
    return if (decision.method == PlaybackMethod.DIRECT) {
        MediaSpec(
            uri = uri,
            mimeType = null,
            subtitles = decision.subtitles.map { s ->
                SubtitleSpec(
                    id = s.id,
                    uri = client.withAccessToken(s.url),
                    language = s.language,
                    label = s.title ?: s.language ?: s.format,
                )
            },
        )
    } else {
        MediaSpec(uri = uri, mimeType = MIME_HLS, subtitles = emptyList())
    }
}
