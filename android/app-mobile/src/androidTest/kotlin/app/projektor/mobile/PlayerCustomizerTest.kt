package app.projektor.mobile

import android.content.pm.ActivityInfo
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.projektor.core.playback.Anchor
import app.projektor.core.playback.PlayerControl
import app.projektor.core.playback.PlayerLayout
import app.projektor.mobile.ui.player.PlayerCustomizer
import app.projektor.mobile.ui.player.Picker
import app.projektor.mobile.ui.player.icon
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

/** The layout editor on its own, with stand-in controls: no server needed. */
@RunWith(AndroidJUnit4::class)
class PlayerCustomizerTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    private var saved: PlayerLayout? = null

    // The editor, like the player, is landscape.
    @Before
    fun landscape() {
        rule.activityRule.scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
        rule.waitForIdle()
    }

    private fun show(initial: PlayerLayout = PlayerLayout.DEFAULT) = rule.setContent {
        MaterialTheme {
            Box(Modifier.background(Color.DarkGray)) {
                PlayerCustomizer(initial, render = { StandIn(it) }, onSave = { saved = it }, onClose = {})
            }
        }
    }

    private fun centerOf(tag: String): Offset = with(rule.density) {
        val b = rule.onNodeWithTag(tag).getBoundsInRoot()
        Offset(((b.left + b.right) / 2).toPx(), ((b.top + b.bottom) / 2).toPx())
    }

    /** Drags [tag] by finger so its centre lands on [to] (root px). */
    private fun drag(tag: String, to: Offset) {
        val by = to - centerOf(tag)
        rule.onNodeWithTag(tag).performTouchInput {
            down(center)
            val steps = 20
            repeat(steps) { i -> moveTo(center + by * ((i + 1f) / steps)); advanceEventTime(16) }
            up()
        }
        rule.waitForIdle()
    }

    private fun save(): PlayerLayout {
        rule.onNodeWithTag("customize-save").performClick()
        return saved!!
    }

    @Test
    fun movesPlayPauseSlightlyHigher() {
        show()
        val before = centerOf("custom-play_pause")
        drag("custom-play_pause", before + Offset(0f, -30f * rule.density.density))
        assertEquals(before.y - 30f * rule.density.density, centerOf("custom-play_pause").y, 2f)
        val p = save().placed.getValue(PlayerControl.PLAY_PAUSE)
        assertEquals(Anchor.CENTER, p.v)
        assertEquals(-30f, p.y, 1f)
    }

    @Test
    fun putsPlus30NextToPlus90() {
        show()
        val ninety = centerOf("custom-skip_90")
        drag("custom-forward_30", ninety + Offset(-76f * rule.density.density, 0f))
        val p = save().placed.getValue(PlayerControl.FORWARD_30)
        // Anchored to the right edge now, like the +90 beside it.
        assertEquals(Anchor.END, p.h)
        assertEquals(ninety.y, centerOf("custom-forward_30").y, 2f)
        assertTrue(abs(centerOf("custom-forward_30").x - (ninety.x - 76f * rule.density.density)) < 2f)
    }

    @Test
    fun snapsToTheMiddle() {
        show()
        val mid = centerOf("custom-play_pause")
        // A little off the middle snaps back onto it.
        drag("custom-replay_10", mid + Offset(4f * rule.density.density, 120f * rule.density.density))
        assertEquals(mid.x, centerOf("custom-replay_10").x, 1.5f)
    }

    @Test
    fun hidesAndAddsButtons() {
        show()
        rule.onNodeWithTag("remove-replay_30").performClick()
        rule.onAllNodesWithTag("custom-replay_30").assertCountEquals(0)
        // The customize button itself can't be hidden.
        rule.onAllNodesWithTag("remove-customize").assertCountEquals(0)
        rule.onNodeWithTag("customize-add").performClick()
        rule.onNodeWithTag("add-lock").performClick()
        val l = save()
        assertTrue(PlayerControl.REPLAY_30 in l.hidden)
        assertEquals(PlayerLayout.DEFAULT_POSITIONS[PlayerControl.LOCK], l.placed[PlayerControl.LOCK])
    }

    @Test
    fun dragsAHiddenButtonOutOfTheAddPanel() {
        show()
        rule.onNodeWithTag("customize-add").performClick()
        val target = with(rule.density) { Offset(60.dp.toPx(), 120.dp.toPx()) }
        val start = centerOf("add-fit")
        rule.onNodeWithTag("add-fit").performTouchInput {
            down(center); advanceEventTime(1_000)
            val steps = 20
            repeat(steps) { i -> moveTo(center + (target - start) * ((i + 1f) / steps)); advanceEventTime(16) }
            up()
        }
        rule.waitForIdle()
        assertEquals(target.y, centerOf("custom-fit").y, 30f)
        assertTrue(PlayerControl.FIT in save().placed)
    }

    @Test
    fun resetRestoresTheDefault() {
        show(PlayerLayout.DEFAULT.remove(PlayerControl.BACK).add(PlayerControl.FIT))
        rule.onNodeWithTag("customize-reset").performClick()
        assertEquals(PlayerLayout.DEFAULT, save())
    }

    /** Holds the editor on screen when asked to (-e hold true), for a screenshot from adb. */
    @Test
    fun holdForScreenshot() {
        if (InstrumentationRegistry.getArguments().getString("hold") != "true") return
        show(PlayerLayout.DEFAULT.add(PlayerControl.LOCK).add(PlayerControl.FIT))
        drag("custom-play_pause", centerOf("custom-play_pause") + Offset(0f, -30f * rule.density.density))
        drag("custom-forward_30", centerOf("custom-skip_90") + Offset(-76f * rule.density.density, 0f))
        Thread.sleep(15_000)
    }
}

/** Roughly the real controls' sizes: 80dp play/pause, 56dp skips, 64dp +90, pills for pickers. */
@androidx.compose.runtime.Composable
private fun StandIn(c: PlayerControl) {
    when (c) {
        PlayerControl.TITLE -> Text("Sample Movie", style = MaterialTheme.typography.titleMedium, color = Color.White)
        PlayerControl.DOUBLE_TAP -> Picker("Double tap 10s", emptyList<Pair<Int, String>>(), {}, "p", compact = true)
        PlayerControl.SPEED -> Picker("Normal", emptyList<Pair<Int, String>>(), {}, "p", compact = true)
        PlayerControl.HOLD_SPEED -> Picker("Hold 2.5×", emptyList<Pair<Int, String>>(), {}, "p", compact = true)
        PlayerControl.AUDIO -> Picker("Audio: Japanese", emptyList<Pair<Int, String>>(), {}, "p", compact = true)
        PlayerControl.SUBTITLES -> Picker("Subtitles: English (SDH)", emptyList<Pair<Int, String>>(), {}, "p", compact = true)
        PlayerControl.NEXT_EPISODE -> OutlinedButton(onClick = {}) { Text("Next episode", style = MaterialTheme.typography.labelMedium, color = Color.White) }
        else -> {
            val size = when (c) { PlayerControl.PLAY_PAUSE -> 80.dp; PlayerControl.SKIP_90 -> 64.dp; PlayerControl.BACK, PlayerControl.CUSTOMIZE -> 48.dp; else -> 56.dp }
            Box(Modifier.size(size).background(Color.Black.copy(alpha = 0.45f), CircleShape), contentAlignment = Alignment.Center) {
                Icon(c.icon, c.label, tint = Color.White)
            }
        }
    }
}
