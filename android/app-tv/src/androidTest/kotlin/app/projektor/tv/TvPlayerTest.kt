package app.projektor.tv

import android.view.KeyEvent
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsNodeInteractionsProvider
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.requestFocus
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

/** Plays a movie on the TV and checks the remote: Left/Right jump by the chosen amount, speed picker works. */
@RunWith(AndroidJUnit4::class)
class TvPlayerTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val serverUrl = InstrumentationRegistry.getArguments().getString("serverUrl") ?: "http://10.0.2.2:8096"
    private val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

    @Before
    fun reset() {
        val c = (rule.activity.application as TvApp).container
        c.sessions.signOut()
        c.playerPrefs.update(skipSeconds = 10, rate = 1f)
    }

    private fun key(code: Int) { device.pressKeyCode(code); rule.waitForIdle(); Thread.sleep(350) }
    private fun waitForTag(tag: String, timeoutMs: Long = 15_000) = rule.waitUntil(timeoutMs) { rule.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
    private fun SemanticsNodeInteractionsProvider.positionMs(): Long =
        onNodeWithTag("position-ms").fetchSemanticsNode().config.getOrNull(SemanticsProperties.Text)?.joinToString { it.text }?.toLongOrNull() ?: 0L

    @Test
    fun remoteSkipsByChosenAmountAndSpeedPickerWorks() {
        rule.onNodeWithTag("server-url").performTextClearance()
        rule.onNodeWithTag("server-url").performTextInput(serverUrl)
        key(KeyEvent.KEYCODE_BACK); key(KeyEvent.KEYCODE_DPAD_DOWN); key(KeyEvent.KEYCODE_DPAD_CENTER)
        waitForTag("profile-Izzan", 20_000)
        Thread.sleep(400); key(KeyEvent.KEYCODE_DPAD_CENTER)
        waitForTag("pin")
        rule.onNodeWithTag("pin").performTextInput("1234")
        key(KeyEvent.KEYCODE_BACK); key(KeyEvent.KEYCODE_DPAD_DOWN); key(KeyEvent.KEYCODE_DPAD_CENTER)

        // Home: the focused tile is a movie (first row). Open it and press Play.
        waitForTag("recent-movie", 20_000)
        Thread.sleep(800)
        key(KeyEvent.KEYCODE_DPAD_CENTER)
        waitForTag("play")
        Thread.sleep(500)
        key(KeyEvent.KEYCODE_DPAD_CENTER)

        waitForTag("position-ms", 20_000)
        rule.waitUntil(30_000) { rule.positionMs() > 1_000 }

        // Pause via the media key so jumps are exact, then Right/Left with controls hidden.
        key(KeyEvent.KEYCODE_MEDIA_PAUSE)
        waitForTag("toggle")
        rule.onNodeWithTag("toggle").assert(hasText("Play"))
        key(KeyEvent.KEYCODE_BACK) // hide controls
        Thread.sleep(500)
        val start = rule.positionMs()
        key(KeyEvent.KEYCODE_DPAD_RIGHT)
        rule.waitUntil(5_000) { abs(rule.positionMs() - (start + 10_000)) < 500 }

        // Open the controls, pick +4s in the skip picker, then Right again jumps 4s.
        key(KeyEvent.KEYCODE_DPAD_DOWN)
        waitForTag("skip-select")
        rule.onNodeWithTag("skip-select").requestFocus()
        key(KeyEvent.KEYCODE_DPAD_CENTER)
        waitForTag("option-+4s")
        rule.onNodeWithTag("option-+4s").requestFocus()
        key(KeyEvent.KEYCODE_DPAD_CENTER)
        rule.waitUntil(5_000) { rule.onAllNodes(hasText("Skip +4s")).fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("skip-forward").assert(hasText("4s ↻"))
        key(KeyEvent.KEYCODE_BACK) // hide controls again
        Thread.sleep(500)
        val before = rule.positionMs()
        key(KeyEvent.KEYCODE_DPAD_RIGHT)
        rule.waitUntil(5_000) { abs(rule.positionMs() - (before + 4_000)) < 500 }
        key(KeyEvent.KEYCODE_DPAD_LEFT)
        rule.waitUntil(5_000) { abs(rule.positionMs() - before) < 500 }

        // Speed picker.
        key(KeyEvent.KEYCODE_DPAD_DOWN)
        waitForTag("speed-select")
        rule.onNodeWithTag("speed-select").requestFocus()
        key(KeyEvent.KEYCODE_DPAD_CENTER)
        waitForTag("option-1.5×")
        rule.onNodeWithTag("option-1.5×").requestFocus()
        key(KeyEvent.KEYCODE_DPAD_CENTER)
        rule.waitUntil(5_000) { rule.onAllNodes(hasText("Speed 1.5×")).fetchSemanticsNodes().isNotEmpty() }
        val prefs = (rule.activity.application as TvApp).container.playerPrefs.settings.value
        assertEquals(4, prefs.skipSeconds)
        assertEquals(1.5f, prefs.rate)
        assertTrue(true)
    }
}
