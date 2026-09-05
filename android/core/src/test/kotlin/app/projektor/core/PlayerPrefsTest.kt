package app.projektor.core

import app.projektor.core.playback.MemoryPlayerPrefs
import app.projektor.core.playback.PlayerSettings
import app.projektor.core.playback.RATE_OPTIONS
import app.projektor.core.playback.SKIP_OPTIONS
import app.projektor.core.playback.formatRate
import app.projektor.core.playback.sanitizeSettings
import org.junit.Assert.assertEquals
import org.junit.Test

class PlayerPrefsTest {
    @Test
    fun `offers the same skip and speed options as the web player`() {
        assertEquals(listOf(3, 4, 5, 6, 7, 8, 9, 10, 15), SKIP_OPTIONS)
        assertEquals(listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f), RATE_OPTIONS)
        assertEquals("Normal", formatRate(1f))
        assertEquals("1.5×", formatRate(1.5f))
        assertEquals("2×", formatRate(2f))
    }

    @Test
    fun `rejects values outside the options and defaults them`() {
        assertEquals(PlayerSettings(10, 1f), sanitizeSettings(42, 9f))
        assertEquals(PlayerSettings(4, 1.25f), sanitizeSettings(4, 1.25f))
        assertEquals(PlayerSettings(), sanitizeSettings(null, null))
    }

    @Test
    fun `update keeps the other field and exposes skipMs`() {
        val prefs = MemoryPlayerPrefs()
        prefs.update(skipSeconds = 7)
        prefs.update(rate = 2f)
        assertEquals(PlayerSettings(7, 2f), prefs.settings.value)
        assertEquals(7000L, prefs.settings.value.skipMs)
    }
}
