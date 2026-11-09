package app.projektor.mobile

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.getBoundsInRoot
import android.content.pm.ActivityInfo
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Before
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.DpRect
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.projektor.core.playback.PlayerControl
import app.projektor.core.playback.PlayerLayout
import app.projektor.core.playback.PlayerZone
import app.projektor.mobile.ui.player.PlayerCustomizer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** The layout editor on its own: no server needed. */
@RunWith(AndroidJUnit4::class)
class PlayerCustomizerTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    // The editor, like the player, is landscape.
    @Before
    fun landscape() {
        rule.activityRule.scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
        rule.waitForIdle()
    }

    private var saved: PlayerLayout? = null

    private fun show(initial: PlayerLayout = PlayerLayout.DEFAULT) = rule.setContent {
        PlayerCustomizer(initial, onSave = { saved = it }, onClose = {})
    }

    private fun centerOf(tag: String): Offset = with(rule.density) {
        val b: DpRect = rule.onNodeWithTag(tag).getBoundsInRoot()
        Offset(((b.left + b.right) / 2).toPx(), ((b.top + b.bottom) / 2).toPx())
    }

    /** Drags the node [from] by finger to the root position [to]. */
    private fun drag(from: String, to: Offset) {
        val start = centerOf(from)
        rule.onNodeWithTag(from).performTouchInput {
            down(center)
            val steps = 20
            repeat(steps) { i -> moveTo(center + (to - start) * ((i + 1f) / steps)); advanceEventTime(16) }
            up()
        }
        rule.waitForIdle()
    }

    private fun save(): PlayerLayout {
        rule.onNodeWithTag("customize-save").performClick()
        return assertNotNull(saved).let { saved!! }
    }

    @Test
    fun dragsAButtonIntoAnotherZone() {
        show()
        drag("custom-play_pause", centerOf("zone-left"))
        val l = save()
        assertEquals(listOf(PlayerControl.PLAY_PAUSE), l.controls(PlayerZone.LEFT))
        assertTrue(PlayerControl.PLAY_PAUSE !in l.controls(PlayerZone.CENTER))
    }

    @Test
    fun reordersWithinAZone() {
        show()
        // Past the last button of the middle row: play/pause moves to the end.
        val end = with(rule.density) { rule.onNodeWithTag("custom-forward_30").getBoundsInRoot().let { Offset(it.right.toPx() + 4f, ((it.top + it.bottom) / 2).toPx()) } }
        drag("custom-play_pause", end)
        assertEquals(PlayerControl.PLAY_PAUSE, save().controls(PlayerZone.CENTER).last())
    }

    @Test
    fun removesAndAddsButtons() {
        show()
        rule.onNodeWithTag("remove-replay_30").performClick()
        rule.onAllNodesWithTag("custom-replay_30").assertCountEquals(0)
        rule.onNodeWithTag("customize-add").performClick()
        rule.onNodeWithTag("custom-lock").performClick()
        val l = save()
        assertTrue(PlayerControl.REPLAY_30 in l.hidden)
        assertEquals(PlayerZone.LEFT, l.zoneOf(PlayerControl.LOCK))
    }

    @Test
    fun dragsToTheBinToRemove() {
        show()
        val c = centerOf("custom-forward_10")
        // The bin replaces the toolbar at the top centre once a drag starts.
        rule.onNodeWithTag("custom-forward_10").performTouchInput {
            down(center); moveBy(Offset(0f, -40f)); advanceEventTime(16)
        }
        rule.waitForIdle()
        val bin = with(rule.density) { rule.onNodeWithTag("customize-bin").getBoundsInRoot().let { Offset(((it.left + it.right) / 2).toPx(), ((it.top + it.bottom) / 2).toPx()) } }
        rule.onNodeWithTag("custom-forward_10").performTouchInput {
            val steps = 20
            val from = c + Offset(0f, -40f)
            repeat(steps) { i -> moveTo(center + (from - c) + (bin - from) * ((i + 1f) / steps)); advanceEventTime(16) }
            up()
        }
        rule.waitForIdle()
        assertTrue(PlayerControl.FORWARD_10 in save().hidden)
    }

    @Test
    fun resetRestoresTheDefault() {
        show(PlayerLayout.DEFAULT.remove(PlayerControl.BACK).add(PlayerControl.FIT))
        rule.onNodeWithTag("customize-reset").performClick()
        assertEquals(PlayerLayout.DEFAULT.encode(), save().encode())
    }
}
