package app.projektor.player

import app.projektor.core.ProjektorClient
import app.projektor.core.api.models.LivePlaybackDecision
import app.projektor.core.api.models.PlaybackDecision
import app.projektor.core.api.models.PlaybackMethod

/** What to hand ExoPlayer, as plain strings so it can be unit tested without the framework. */
data class MediaSpec(val uri: String, val mimeType: String?, val subtitles: List<SubtitleSpec>) {
    val isHls: Boolean get() = mimeType == MIME_HLS
}

/**
 * One sideloaded subtitle. ASS and SSA tracks come as the original script ([MIME_SSA]) for libass,
 * with [fontsUri] listing the fonts attached to the media file; everything else as WebVTT.
 */
data class SubtitleSpec(
    val id: String,
    val uri: String,
    val language: String?,
    val label: String,
    val mimeType: String = MIME_VTT,
    val fontsUri: String? = null,
)

const val MIME_HLS = "application/x-mpegURL"
const val MIME_VTT = "text/vtt"
const val MIME_SSA = "text/x-ssa"
const val MIME_TS = "video/mp2t"

/**
 * Direct play streams the file, remux and transcode the HLS master. Either way the server's
 * subtitles are sideloaded: ASS as written, for libass, the rest as WebVTT. (The master's own
 * WebVTT renditions are left alone, so an ASS track keeps its styling under HLS too.)
 */
fun mediaSpecFor(decision: PlaybackDecision, client: ProjektorClient): MediaSpec {
    val subtitles = decision.subtitles.map { s ->
        val ass = s.assUrl
        SubtitleSpec(
            id = s.id,
            uri = client.withAccessToken(ass ?: s.url),
            language = s.language,
            label = s.title ?: s.language ?: s.format,
            mimeType = if (ass != null) MIME_SSA else MIME_VTT,
            fontsUri = s.fontsUrl?.takeIf { ass != null }?.let(client::withAccessToken),
        )
    }
    val uri = client.withAccessToken(decision.url)
    val mime = if (decision.method == PlaybackMethod.DIRECT) null else MIME_HLS
    return MediaSpec(uri = uri, mimeType = mime, subtitles = subtitles)
}

/**
 * Provider content. A live channel arrives as a raw MPEG-TS relay, which ExoPlayer plays as an
 * unbounded progressive stream when told the MIME type; catch-up and provider files are either HLS
 * or a plain file the extractor can sniff.
 */
fun liveMediaSpecFor(decision: LivePlaybackDecision, client: ProjektorClient): MediaSpec {
    val uri = client.withAccessToken(decision.url)
    val mime = when {
        decision.method == LivePlaybackDecision.Method.HLS -> MIME_HLS
        decision.kind == LivePlaybackDecision.Kind.LIVE || decision.kind == LivePlaybackDecision.Kind.RECORDING -> MIME_TS
        else -> null
    }
    return MediaSpec(uri = uri, mimeType = mime, subtitles = emptyList())
}
