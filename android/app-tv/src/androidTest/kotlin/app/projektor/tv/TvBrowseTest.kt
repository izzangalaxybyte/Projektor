package app.projektor.tv

import android.view.KeyEvent
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isFocused
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Signs in by typing (the sign-in screen is the one place a keyboard is expected), then browses
 * with the D-pad only: down to the TV row, centre on Sample Show, down to Seasons, centre, down to
 * Episodes, centre, and expects the Episode 2 detail.
 */
@RunWith(AndroidJUnit4::class)
class TvBrowseTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val serverUrl = InstrumentationRegistry.getArguments().getString("serverUrl") ?: "http://10.0.2.2:8096"
    private val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

    @Before
    fun signOut() {
        (rule.activity.application as TvApp).container.sessions.signOut()
    }

    private fun key(code: Int) {
        device.pressKeyCode(code)
        rule.waitForIdle()
        Thread.sleep(350)
    }

    private fun waitForTag(tag: String, timeoutMs: Long = 15_000) = rule.waitUntil(timeoutMs) { rule.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }

    @Test
    fun browsesFromHomeToAnEpisodeWithTheDpad() {
        rule.onNodeWithTag("server-url").performTextClearance()
        rule.onNodeWithTag("server-url").performTextInput(serverUrl)
        rule.onNodeWithTag("server-url").assert(hasText(serverUrl))
        key(KeyEvent.KEYCODE_BACK) // close the on-screen keyboard
        key(KeyEvent.KEYCODE_DPAD_DOWN) // field → Continue
        key(KeyEvent.KEYCODE_DPAD_CENTER)
        rule.waitUntil(20_000) {
            rule.onAllNodesWithTag("profile-Izzan").fetchSemanticsNodes().isNotEmpty() || rule.onAllNodesWithTag("auth-error").fetchSemanticsNodes().isNotEmpty()
        }
        if (rule.onAllNodesWithTag("auth-error").fetchSemanticsNodes().isNotEmpty()) {
            val msg = rule.onNodeWithTag("auth-error").fetchSemanticsNode().config.getOrNull(SemanticsProperties.Text)?.joinToString { it.text }
            throw AssertionError("sign-in failed: $msg")
        }
        Thread.sleep(400) // first profile card takes focus
        key(KeyEvent.KEYCODE_DPAD_CENTER)
        waitForTag("pin")
        rule.onNodeWithTag("pin").performTextInput("1234")
        key(KeyEvent.KEYCODE_BACK)
        key(KeyEvent.KEYCODE_DPAD_DOWN) // PIN → Sign in
        key(KeyEvent.KEYCODE_DPAD_CENTER)

        waitForTag("recent-tv", 20_000)
        Thread.sleep(800) // initial focus lands on the first tile of the first row
        rule.onNode(isFocused()).assert(hasAnyAncestor(hasTestTag("recent-movie")))
        key(KeyEvent.KEYCODE_DPAD_DOWN) // Recently added · Movies → Recently added · TV Shows
        rule.onNode(isFocused()).assert(hasAnyAncestor(hasTestTag("recent-tv")))
        key(KeyEvent.KEYCODE_DPAD_CENTER)
        waitForTag("item-title")
        rule.onNodeWithTag("item-title").assert(hasText("Sample Show"))

        Thread.sleep(500) // focus lands on Play
        key(KeyEvent.KEYCODE_DPAD_DOWN) // to the Seasons row
        key(KeyEvent.KEYCODE_DPAD_CENTER)
        rule.waitUntil(15_000) { rule.onAllNodes(hasText("Season 1")).fetchSemanticsNodes().isNotEmpty() }

        Thread.sleep(500)
        key(KeyEvent.KEYCODE_DPAD_DOWN) // to the Episodes row
        key(KeyEvent.KEYCODE_DPAD_CENTER)
        rule.waitUntil(15_000) { rule.onAllNodes(hasText("Episode 2")).fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("play").assertExists()
        rule.onNodeWithTag("file-info").assert(hasText("video: hevc", substring = true))
    }
}
