package app.projektor.core.playback

import android.media.MediaCodecInfo.CodecProfileLevel
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

    /**
     * Builds a profile from the decoder MIME types a device advertises. [tenBitMimes] are the MIME
     * types some decoder lists a 10-bit profile for (AV1 Main 10, HEVC Main 10, VP9 Profile 2); the
     * server sends 10-bit video as is only to codecs listed with a "10" suffix.
     */
    fun fromMimeTypes(
        decoderMimes: Collection<String>,
        name: String,
        maxWidth: Int? = null,
        maxBitrate: Int? = null,
        tenBitMimes: Collection<String> = emptyList(),
    ): DeviceProfileInput {
        val mimes = decoderMimes.map { it.lowercase() }.toSet()
        val tenBit = tenBitMimes.map { it.lowercase() }.toSet()
        val codecs = VIDEO_MIMES.filterKeys { it in mimes }
        // MediaCodec HEVC decoders on anything recent handle Main 10 even when they don't list it,
        // and the display (or the TV) tone-maps HDR itself, so the server is told not to.
        val tenBitCodecs = codecs.filterKeys { it in tenBit }.values + listOfNotNull("hevc".takeIf { "hevc" in codecs.values })
        return DeviceProfileInput(
            name = name,
            containers = CONTAINERS,
            videoCodecs = (codecs.values + tenBitCodecs.distinct().map { "${it}10" }).distinct(),
            audioCodecs = AUDIO_MIMES.filterKeys { it in mimes }.values.distinct(),
            maxWidth = maxWidth?.toLong(),
            maxBitrate = maxBitrate?.toLong(),
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
    ): DeviceProfileInput = fromMimeTypes(decoderMimeTypes(), name, maxWidth, maxBitrate, tenBitDecoderMimeTypes())

    /** 10-bit profile of each codec, as MediaCodec names it. */
    private val TEN_BIT_PROFILES: Map<String, Set<Int>> = mapOf(
        "video/av01" to setOf(CodecProfileLevel.AV1ProfileMain10, CodecProfileLevel.AV1ProfileMain10HDR10, CodecProfileLevel.AV1ProfileMain10HDR10Plus),
        "video/hevc" to setOf(CodecProfileLevel.HEVCProfileMain10, CodecProfileLevel.HEVCProfileMain10HDR10, CodecProfileLevel.HEVCProfileMain10HDR10Plus),
        "video/x-vnd.on2.vp9" to setOf(CodecProfileLevel.VP9Profile2, CodecProfileLevel.VP9Profile2HDR, CodecProfileLevel.VP9Profile2HDR10Plus),
    )

    /**
     * MIME types a hardware decoder lists a 10-bit profile for. Without this a phone reported 10-bit
     * AV1 as unsupported and the server, which has no AV1 hardware, transcoded it slowly. Software
     * decoders are left out: the emulator's dav1d decodes 10-bit AV1 but its output reaches the
     * screen as garbage, and whether a device's graphics stack draws it right cannot be asked.
     */
    fun tenBitDecoderMimeTypes(): Set<String> =
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) emptySet() else MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos
            .filter { !it.isEncoder && it.isHardwareAccelerated }
            .flatMap { info ->
                info.supportedTypes.filter { type ->
                    val wanted = TEN_BIT_PROFILES[type.lowercase()] ?: return@filter false
                    runCatching { info.getCapabilitiesForType(type).profileLevels.any { it.profile in wanted } }.getOrDefault(false)
                }
            }
            .map { it.lowercase() }
            .toSet()

    /** Every MIME type some hardware or software decoder on this device supports. */
    fun decoderMimeTypes(): Set<String> =
        MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos
            .filter { !it.isEncoder }
            .flatMap { it.supportedTypes.asList() }
            .map { it.lowercase() }
            .toSet()
}
