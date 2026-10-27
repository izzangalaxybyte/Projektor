package app.projektor.core

import app.projektor.core.api.models.MediaFile
import app.projektor.core.api.models.StreamInfo
import app.projektor.core.items.closestVersion
import app.projektor.core.items.describeVersion
import org.junit.Assert.assertEquals
import org.junit.Test

class VersionsTest {
    private fun stream(type: StreamInfo.Type, codec: String, language: String? = null, height: Long? = null, bitDepth: Long? = null, title: String? = null) =
        StreamInfo(index = 0, type = type, codec = codec, language = language, title = title, isDefault = false, isForced = false, width = null, height = height, channels = null, bitDepth = bitDepth, hdr = false)

    private fun file(name: String, size: Long, streams: List<StreamInfo> = emptyList()) =
        MediaFile(id = name, fileName = name, sizeBytes = size, container = "mkv", durationMs = 1_440_000, bitrate = null, streams = streams, subtitles = emptyList())

    @Test
    fun `describes resolution, codec, audio languages, duration and size`() {
        val f = file(
            "Blue Box S01E01.mkv",
            684_000_000,
            listOf(
                stream(StreamInfo.Type.VIDEO, "av1", height = 1080, bitDepth = 10),
                stream(StreamInfo.Type.AUDIO, "opus", language = "jpn"),
                stream(StreamInfo.Type.AUDIO, "opus", language = "eng"),
            ),
        )
        assertEquals("1080p · AV1 10-bit · Audio: Japanese, English · 24m · 652 MB", describeVersion(f))
    }

    @Test
    fun `keeps to the release being watched for the next episode`() {
        val sub = file("[SubsPlease] Sono Bisque Doll wa Koi wo Suru - 02 (1080p).mkv", 1_400_000_000)
        val dub = file("My Dress-Up Darling - S01E02 [Dual-Audio].mkv", 900_000_000)
        assertEquals(dub, closestVersion("My Dress-Up Darling - S01E01 [Dual-Audio].mkv", listOf(sub, dub)))
        assertEquals(sub, closestVersion("[SubsPlease] Sono Bisque Doll wa Koi wo Suru - 01 (1080p).mkv", listOf(sub, dub)))
        assertEquals(sub, closestVersion(null, listOf(sub, dub)))
    }
}
