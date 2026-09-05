package app.projektor.tv

import android.view.KeyEvent
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.requestFocus
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Records a channel for 15 s with the remote's record key, then finds and plays it under Recordings. */
@RunWith(AndroidJUnit4::class)
class TvRecordTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val serverUrl = InstrumentationRegistry.getArguments().getString("serverUrl") ?: "http://10.0.2.2:8096"
    private val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

    @Before
    fun signOut() { (rule.activity.application as TvApp).container.sessions.signOut() }

    private fun key(code: Int) { device.pressKeyCode(code); rule.waitForIdle(); Thread.sleep(350) }
    private fun waitForTag(tag: String, timeoutMs: Long = 15_000) = rule.waitUntil(timeoutMs) { rule.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
    private fun textOf(tag: String): String = rule.onNodeWithTag(tag).fetchSemanticsNode().config.getOrNull(SemanticsProperties.Text)?.joinToString { it.text } ?: ""

    @Test
    fun recordsFifteenSecondsAndPlaysItBack() {
        rule.onNodeWithTag("server-url").performTextClearance()
        rule.onNodeWithTag("server-url").performTextInput(serverUrl)
        key(KeyEvent.KEYCODE_BACK)
        key(KeyEvent.KEYCODE_DPAD_DOWN)
        key(KeyEvent.KEYCODE_DPAD_CENTER)
        rule.waitUntil(20_000) { rule.onAllNodesWithTag("profile-Izzan").fetchSemanticsNodes().isNotEmpty() }
        Thread.sleep(400)
        key(KeyEvent.KEYCODE_DPAD_CENTER)
        waitForTag("pin")
        rule.onNodeWithTag("pin").performTextInput("1234")
        key(KeyEvent.KEYCODE_BACK)
        key(KeyEvent.KEYCODE_DPAD_DOWN)
        key(KeyEvent.KEYCODE_DPAD_CENTER)
        waitForTag("tabs", 20_000)

        rule.onNodeWithTag("tab-live").requestFocus()
        waitForTag("channel-1001", 20_000)
        Thread.sleep(600)
        key(KeyEvent.KEYCODE_DPAD_CENTER)
        waitForTag("channel-name")
        rule.waitUntil(15_000) { textOf("channel-name").contains("Sport One HD") }
        rule.waitUntil(40_000) { (textOf("position-ms").toLongOrNull() ?: 0L) > 1_000 }

        key(KeyEvent.KEYCODE_MEDIA_RECORD)
        waitForTag("rec-indicator")
        rule.onNodeWithTag("notice").assert(hasText("Recording: Big Match"))
        Thread.sleep(15_000)
        key(KeyEvent.KEYCODE_MEDIA_RECORD)
        rule.waitUntil(10_000) { rule.onAllNodesWithTag("rec-indicator").fetchSemanticsNodes().isEmpty() }

        key(KeyEvent.KEYCODE_BACK) // leave the player
        waitForTag("tabs", 20_000)
        rule.onNodeWithTag("tab-live").requestFocus()
        waitForTag("open-recordings")
        rule.onNodeWithTag("open-recordings").requestFocus()
        key(KeyEvent.KEYCODE_DPAD_CENTER)
        waitForTag("recordings-title")
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("recording-list").fetchSemanticsNodes().isNotEmpty() && rule.onAllNodes(hasText("Big Match")).fetchSemanticsNodes().isNotEmpty() }
        rule.waitUntil(15_000) { rule.onAllNodes(hasText("Done")).fetchSemanticsNodes().isNotEmpty() }
        Thread.sleep(500)
        key(KeyEvent.KEYCODE_DPAD_CENTER) // the first (only) recording is focused → actions
        waitForTag("play")
        key(KeyEvent.KEYCODE_DPAD_CENTER) // Play is focused first
        waitForTag("position-ms")
        rule.waitUntil(40_000) { (textOf("position-ms").toLongOrNull() ?: 0L) > 1_000 }
        key(KeyEvent.KEYCODE_DPAD_DOWN)
        waitForTag("decision")
        rule.onNodeWithTag("decision").assert(hasText("Recording"))
    }
}
