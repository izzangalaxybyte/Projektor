package app.projektor.core

import app.projektor.core.playback.PlayerControl
import app.projektor.core.playback.PlayerLayout
import app.projektor.core.playback.PlayerZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerLayoutTest {
    @Test
    fun `round-trips through its stored form, empty zones included`() {
        val layout = PlayerLayout.DEFAULT.remove(PlayerControl.BACK).move(PlayerControl.LOCK, PlayerZone.LEFT)
        val back = PlayerLayout.decode(layout.encode())
        assertEquals(layout.encode(), back.encode())
        assertTrue(back.controls(PlayerZone.TOP_START).isEmpty())
        assertEquals(listOf(PlayerControl.LOCK), back.controls(PlayerZone.LEFT))
    }

    @Test
    fun `falls back to the default and drops unknown or repeated entries`() {
        assertEquals(PlayerLayout.DEFAULT, PlayerLayout.decode(null))
        assertEquals(PlayerLayout.DEFAULT, PlayerLayout.decode("nonsense"))
        val l = PlayerLayout.decode("CENTER=PLAY_PAUSE,WHAT,PLAY_PAUSE;MARS=BACK;LEFT=PLAY_PAUSE,BACK")
        assertEquals(listOf(PlayerControl.PLAY_PAUSE), l.controls(PlayerZone.CENTER))
        assertEquals(listOf(PlayerControl.BACK), l.controls(PlayerZone.LEFT))
    }

    @Test
    fun `moves within and between zones, and adds hidden controls to their default zone`() {
        val centre = PlayerLayout.DEFAULT.move(PlayerControl.PLAY_PAUSE, PlayerZone.CENTER, 0).controls(PlayerZone.CENTER)
        assertEquals(PlayerControl.PLAY_PAUSE, centre.first())
        assertEquals(5, centre.size)

        val moved = PlayerLayout.DEFAULT.move(PlayerControl.SPEED, PlayerZone.TOP_END)
        assertEquals(listOf(PlayerControl.SPEED), moved.controls(PlayerZone.TOP_END))
        assertTrue(PlayerControl.SPEED !in moved.controls(PlayerZone.BOTTOM_START))

        assertTrue(PlayerControl.FIT in PlayerLayout.DEFAULT.hidden)
        val added = PlayerLayout.DEFAULT.add(PlayerControl.FIT)
        assertEquals(PlayerZone.TOP_END, added.zoneOf(PlayerControl.FIT))
        assertNull(added.remove(PlayerControl.FIT).zoneOf(PlayerControl.FIT))
    }
}
