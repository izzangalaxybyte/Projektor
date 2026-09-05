package app.projektor.player

import app.projektor.core.ProjektorClient
import app.projektor.core.api.models.PlaybackDecision
import app.projektor.core.api.models.PlaybackMethod
import app.projektor.core.api.models.SubtitleTrack
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaSpecTest {
    private val client = ProjektorClient("http://box:8096", { "tok" })
    private val subs = listOf(
        SubtitleTrack(id = "s1", source = SubtitleTrack.Source.EMBEDDED, streamIndex = 2, language = "eng", title = null, format = "subrip", url = "/api/subtitles/s1.vtt"),
        SubtitleTrack(id = "s2", source = SubtitleTrack.Source.EXTERNAL, streamIndex = null, language = null, title = "Forced", format = "subrip", url = "/api/subtitles/s2.vtt"),
    )

    private fun decision(method: PlaybackMethod, url: String) = PlaybackDecision(
        method = method, video = PlaybackDecision.Video.COPY, audio = PlaybackDecision.Audio.COPY,
        url = url, sessionId = null, reason = "", subtitles = subs,
    )

    @Test
    fun `direct play streams the file and sideloads every subtitle as WebVTT with the token`() {
        val spec = mediaSpecFor(decision(PlaybackMethod.DIRECT, "/api/files/f1/stream"), client)
        assertEquals("http://box:8096/api/files/f1/stream?access_token=tok", spec.uri)
        assertNull(spec.mimeType)
        assertEquals(listOf("http://box:8096/api/subtitles/s1.vtt?access_token=tok", "http://box:8096/api/subtitles/s2.vtt?access_token=tok"), spec.subtitles.map { it.uri })
        assertEquals(listOf("eng", "Forced"), spec.subtitles.map { it.label })
        assertEquals(false, spec.isHls)
    }

    @Test
    fun `remux and transcode point at the HLS master and leave subtitles to the playlist`() {
        for (m in listOf(PlaybackMethod.REMUX, PlaybackMethod.TRANSCODE)) {
            val spec = mediaSpecFor(decision(m, "/api/playback/sessions/abc/master.m3u8"), client)
            assertEquals("http://box:8096/api/playback/sessions/abc/master.m3u8?access_token=tok", spec.uri)
            assertEquals(MIME_HLS, spec.mimeType)
            assertTrue(spec.isHls)
            assertTrue(spec.subtitles.isEmpty())
        }
    }
}
