package app.projektor.core

import app.projektor.core.playback.Anchor
import app.projektor.core.playback.ControlPosition
import app.projektor.core.playback.PlayerControl
import app.projektor.core.playback.PlayerLayout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerLayoutTest {
    @Test
    fun `round-trips through its stored form`() {
        val layout = PlayerLayout.DEFAULT.remove(PlayerControl.BACK).place(PlayerControl.LOCK, ControlPosition(Anchor.START, 24.5f, Anchor.CENTER, -12f))
        assertEquals(layout, PlayerLayout.decode(layout.encode()))
    }

    @Test
    fun `falls back to the default, drops broken entries and keeps the customize button`() {
        assertEquals(PlayerLayout.DEFAULT, PlayerLayout.decode(null))
        assertEquals(PlayerLayout.DEFAULT, PlayerLayout.decode("nonsense"))
        // The earlier zone format reads as nothing usable.
        assertEquals(PlayerLayout.DEFAULT, PlayerLayout.decode("TOP_START=BACK;CENTER=PLAY_PAUSE"))
        val l = PlayerLayout.decode("PLAY_PAUSE=C:0:C:-20;WHAT=S:1:S:1;BACK=S:x:S:1;PLAY_PAUSE=S:0:S:0")
        assertEquals(setOf(PlayerControl.PLAY_PAUSE, PlayerControl.CUSTOMIZE), l.placed.keys)
        assertEquals(ControlPosition(Anchor.CENTER, 0f, Anchor.CENTER, -20f), l.placed[PlayerControl.PLAY_PAUSE])
    }

    @Test
    fun `the customize button can't be removed`() {
        assertTrue(PlayerControl.CUSTOMIZE in PlayerLayout.DEFAULT.remove(PlayerControl.CUSTOMIZE).placed)
    }

    @Test
    fun `places by the nearest edge or the middle and stays on screen`() {
        // 1000x400 px screen, density 2, a 100x50 px control.
        val right = ControlPosition.of(880f, 10f, 100f, 50f, 1000f, 400f, 2f)
        assertEquals(ControlPosition(Anchor.END, 10f, Anchor.START, 5f), right)
        assertEquals(880f, right.left(1000f, 100f, 2f))
        // On a wider screen it keeps its distance from the right edge.
        assertEquals(1280f, right.left(1400f, 100f, 2f))

        val middle = ControlPosition.of(450f, 160f, 100f, 50f, 1000f, 400f, 2f)
        assertEquals(ControlPosition(Anchor.CENTER, 0f, Anchor.CENTER, -7.5f), middle)
        assertEquals(160f, middle.top(400f, 50f, 2f))

        // Never off screen, however far it is stored.
        assertEquals(0f, ControlPosition(Anchor.START, -500f, Anchor.START, 0f).left(1000f, 100f, 2f))
        assertEquals(900f, ControlPosition(Anchor.START, 5000f, Anchor.START, 0f).left(1000f, 100f, 2f))
    }

    @Test
    fun `adds hidden controls where they go by default`() {
        assertTrue(PlayerControl.FIT in PlayerLayout.DEFAULT.hidden)
        val added = PlayerLayout.DEFAULT.add(PlayerControl.FIT)
        assertEquals(PlayerLayout.DEFAULT_POSITIONS[PlayerControl.FIT], added.placed[PlayerControl.FIT])
        assertTrue(PlayerControl.entries.all { it in PlayerLayout.DEFAULT_POSITIONS })
    }
}
