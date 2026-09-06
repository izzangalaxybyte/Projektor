package app.projektor.core

import app.projektor.core.live.LiveGuide
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

class LiveGuideTest {
    private data class Ch(val id: String, val number: Long?)
    private val channels = listOf(Ch("a", 1L), Ch("b", 2L), Ch("c", null))

    @Test fun parsesServerTimestamps() {
        assertEquals(1_788_000_000_000L, LiveGuide.parseIso("2026-08-29T10:40:00.000Z"))
        assertEquals(1_788_000_000_000L, LiveGuide.parseIso("2026-08-29T10:40:00Z"))
        assertEquals(0L, LiveGuide.parseIso("garbage"))
    }

    @Test fun progressAndClock() {
        val start = "2026-08-29T14:00:00.000Z"
        val end = "2026-08-29T15:00:00.000Z"
        assertEquals(0.5f, LiveGuide.progress(start, end, LiveGuide.parseIso("2026-08-29T14:30:00.000Z")), 0.001f)
        assertEquals(0f, LiveGuide.progress(start, end, LiveGuide.parseIso("2026-08-29T13:00:00.000Z")), 0.001f)
        assertEquals(1f, LiveGuide.progress(start, end, LiveGuide.parseIso("2026-08-29T16:00:00.000Z")), 0.001f)
        assertEquals("16:00", LiveGuide.clock(start, TimeZone.getTimeZone("Europe/Berlin")))
        assertTrue(LiveGuide.hasEnded(end, LiveGuide.parseIso("2026-08-29T15:00:00.000Z")))
        assertFalse(LiveGuide.hasEnded(end, LiveGuide.parseIso("2026-08-29T14:59:00.000Z")))
    }

    @Test fun neighbourWrapsAndFallsBack() {
        assertEquals("b", LiveGuide.neighbour(channels, "a", 1) { it.id }?.id)
        assertEquals("a", LiveGuide.neighbour(channels, "c", 1) { it.id }?.id)
        assertEquals("c", LiveGuide.neighbour(channels, "a", -1) { it.id }?.id)
        assertEquals("a", LiveGuide.neighbour(channels, "zzz", 1) { it.id }?.id)
        assertNull(LiveGuide.neighbour(emptyList<Ch>(), "a", 1) { it.id })
    }

    @Test fun byNumber() {
        assertEquals("b", LiveGuide.byNumber(channels, "2") { it.number }?.id)
        assertEquals("b", LiveGuide.byNumber(channels, "02") { it.number }?.id)
        assertNull(LiveGuide.byNumber(channels, "9") { it.number })
        assertNull(LiveGuide.byNumber(channels, "") { it.number })
    }

    @Test fun archiveWindow() {
        val now = LiveGuide.parseIso("2026-08-29T14:00:00.000Z")
        assertTrue(LiveGuide.inArchive("2026-08-28T14:00:00.000Z", true, 3, now))
        assertFalse(LiveGuide.inArchive("2026-08-20T14:00:00.000Z", true, 3, now))
        assertFalse(LiveGuide.inArchive("2026-08-28T14:00:00.000Z", false, 3, now))
    }
}
