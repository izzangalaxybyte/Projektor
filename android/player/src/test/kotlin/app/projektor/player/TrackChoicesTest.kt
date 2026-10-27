package app.projektor.player

import app.projektor.core.api.models.PlaybackDecision
import app.projektor.core.api.models.PlaybackMethod
import app.projektor.core.api.models.SubtitleTrack
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TrackChoicesTest {
    private val full = SubtitleTrack(id = "s1", source = SubtitleTrack.Source.EMBEDDED, streamIndex = 4, language = "eng", title = "English [whomst]", format = "ass", url = "/a.vtt", assUrl = null, fontsUrl = null)
    private val signs = full.copy(id = "s2", streamIndex = 5, title = "English \"Signs\"")
    private val decision = PlaybackDecision(
        method = PlaybackMethod.REMUX, video = PlaybackDecision.Video.COPY, audio = PlaybackDecision.Audio.COPY,
        url = "/m.m3u8", sessionId = null, reason = "", subtitles = listOf(full, signs),
        audioStreamIndex = null, preferredSubtitleId = null, subtitlesOff = false,
    )

    @Test
    fun `a sideloaded track is recognised by the server id in its track id`() {
        assertEquals(full, decision.subtitleFor(TrackOption("1:s1", "English [whomst]", "en")))
    }

    @Test
    fun `an HLS track is recognised by the name the server gave it`() {
        assertEquals(signs, decision.subtitleFor(TrackOption("subs:English 'Signs'", "English 'Signs'", "en")))
        assertNull(decision.subtitleFor(TrackOption("subs:French", "French", "fr")))
    }
}
