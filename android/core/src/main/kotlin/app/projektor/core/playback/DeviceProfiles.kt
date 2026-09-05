package app.projektor.core.playback

import android.media.MediaCodecList
import android.os.Build
import app.projektor.core.api.models.DeviceProfileInput

/**
 * Describes what this device can decode so the server can pick direct play, remux, or transcode.
 * The mapping from MIME types to the server's codec names is pure and unit tested; the
 * MediaCodecList adapter is the only Android-specific piece.
 */
object DeviceProfiles {
    /** MIME type reported by MediaCodecList to the codec name the server's decision uses. */
    val VIDEO_MIMES: Map<String, String> = mapOf(
        "video/avc" to "h264",
        "video/hevc" to "hevc",
        "video/x-vnd.on2.vp9" to "vp9",
        "video/av01" to "av1",
    )
    val AUDIO_MIMES: Map<String, String> = mapOf(
        "audio/mp4a-latm" to "aac",
        "audio/ac3" to "ac3",
        "audio/eac3" to "eac3",
        "audio/opus" to "opus",
        "audio/mpeg" to "mp3",
        "audio/flac" to "flac",
    )

    /** Containers Media3's extractors demux regardless of codecs. */
    val CONTAINERS: List<String> = listOf("mp4", "mkv", "webm", "mov", "ts", "avi")

    /** Builds a profile from the decoder MIME types a device advertises. */
    fun fromMimeTypes(
        decoderMimes: Collection<String>,
        name: String,
        maxWidth: Int? = null,
        maxBitrate: Int? = null,
    ): DeviceProfileInput {
        val mimes = decoderMimes.map { it.lowercase() }.toSet()
        return DeviceProfileInput(
            name = name,
            containers = CONTAINERS,
            // MediaCodec HEVC decoders on anything recent handle Main 10, and the display (or the
            // TV) tone-maps HDR itself, so the server is told not to.
            videoCodecs = VIDEO_MIMES.filterKeys { it in mimes }.values.distinct().let { if ("hevc" in it) it + "hevc10" else it },
            audioCodecs = AUDIO_MIMES.filterKeys { it in mimes }.values.distinct(),
            maxWidth = maxWidth,
            maxBitrate = maxBitrate,
            // ExoPlayer plays both; fMP4 is the same choice the web player makes.
            hlsSegmentContainer = DeviceProfileInput.HlsSegmentContainer.FMP4,
            hdr = true,
        )
    }

    /** The real device's decoders, by name and model. */
    fun current(
        name: String = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
        maxWidth: Int? = null,
        maxBitrate: Int? = null,
    ): DeviceProfileInput = fromMimeTypes(decoderMimeTypes(), name, maxWidth, maxBitrate)

    /** Every MIME type some hardware or software decoder on this device supports. */
    fun decoderMimeTypes(): Set<String> =
        MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos
            .filter { !it.isEncoder }
            .flatMap { it.supportedTypes.asList() }
            .map { it.lowercase() }
            .toSet()
}
