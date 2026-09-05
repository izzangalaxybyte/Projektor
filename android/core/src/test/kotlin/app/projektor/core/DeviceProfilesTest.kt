package app.projektor.core

import app.projektor.core.api.models.DeviceProfileInput
import app.projektor.core.playback.DeviceProfiles
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeviceProfilesTest {
    @Test
    fun `maps decoder MIME types to the server's codec names and ignores the rest`() {
        val emulatorLike = listOf(
            "video/avc", "video/x-vnd.on2.vp9", "video/3gpp", "audio/mp4a-latm", "audio/opus", "audio/amr-wb", "audio/mpeg",
        )
        val p = DeviceProfiles.fromMimeTypes(emulatorLike, "Emulator")
        assertEquals("Emulator", p.name)
        assertEquals(listOf("h264", "vp9"), p.videoCodecs)
        assertEquals(listOf("aac", "opus", "mp3"), p.audioCodecs)
        assertEquals(DeviceProfiles.CONTAINERS, p.containers)
        assertEquals(DeviceProfileInput.HlsSegmentContainer.FMP4, p.hlsSegmentContainer)
        assertNull(p.maxWidth)
        assertNull(p.maxBitrate)
    }

    @Test
    fun `a TV with hardware HEVC and AC3 advertises both, case-insensitively`() {
        val tv = listOf("Video/HEVC", "video/avc", "AUDIO/AC3", "audio/eac3", "audio/mp4a-latm")
        val p = DeviceProfiles.fromMimeTypes(tv, "Shield", maxWidth = 3840, maxBitrate = 40_000_000)
        assertEquals(listOf("h264", "hevc"), p.videoCodecs)
        assertEquals(listOf("aac", "ac3", "eac3"), p.audioCodecs)
        assertEquals(3840, p.maxWidth)
        assertEquals(40_000_000, p.maxBitrate)
    }

    @Test
    fun `no known decoders still yields a valid profile that forces transcoding`() {
        val p = DeviceProfiles.fromMimeTypes(emptyList(), "Odd box")
        assertEquals(emptyList<String>(), p.videoCodecs)
        assertEquals(emptyList<String>(), p.audioCodecs)
    }
}
