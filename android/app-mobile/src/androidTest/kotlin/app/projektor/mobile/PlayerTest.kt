package app.projektor.mobile

import androidx.compose.ui.test.SemanticsNodeInteractionsProvider
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

/** Needs the API on the host with the fixtures scanned and the admin "Izzan"/1234 created. */
@RunWith(AndroidJUnit4::class)
class PlayerTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val serverUrl = InstrumentationRegistry.getArguments().getString("serverUrl") ?: "http://10.0.2.2:8096"

    @Before
    fun reset() {
        val c = (rule.activity.application as ProjektorApp).container
        c.sessions.signOut()
        c.playerPrefs.update(skipSeconds = 10, rate = 1f)
    }

    private fun SemanticsNodeInteractionsProvider.positionMs(): Long =
        onNodeWithTag("position-ms").fetchSemanticsNode().config.getOrNull(SemanticsProperties.Text)?.joinToString { it.text }?.toLongOrNull() ?: 0L

    @Test
    fun skipsByTheChosenAmountAndChangesSpeed() {
        rule.onNodeWithTag("server-url").performTextClearance()
        rule.onNodeWithTag("server-url").performTextInput(serverUrl)
        rule.onNodeWithTag("server-continue").performClick()
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("profile-Izzan").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("profile-Izzan").performClick()
        rule.onNodeWithTag("pin").performTextInput("1234")
        rule.onNodeWithTag("pin-submit").performClick()
        rule.waitUntil(20_000) { rule.onAllNodesWithTag("tab-movies").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("tab-movies").performClick()
        rule.waitUntil(15_000) { rule.onAllNodes(hasText("Sample Movie")).fetchSemanticsNodes().isNotEmpty() }
        rule.onAllNodes(hasText("Sample Movie")).onFirst().performClick()
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("play").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("play").performClick()

        // Playing: position advances.
        rule.waitUntil(30_000) { rule.onAllNodesWithTag("decision").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("decision").assert(hasText("Direct play"))
        rule.waitUntil(30_000) { rule.positionMs() > 1_000 }

        // Pause so jumps are exact, then choose +4s and skip forward and back.
        rule.onNodeWithTag("toggle").performClick()
        rule.waitUntil(5_000) { rule.onAllNodesWithTag("toggle").fetchSemanticsNodes().isNotEmpty() }
        Thread.sleep(700)
        rule.onNodeWithTag("skip-select").performClick()
        rule.onNodeWithTag("skip-select-+4s").performClick()
        rule.waitUntil(5_000) { rule.onAllNodes(hasText("Skip +4s")).fetchSemanticsNodes().isNotEmpty() }
        val before = rule.positionMs()
        rule.onNodeWithTag("skip-forward").performClick()
        rule.waitUntil(5_000) { abs(rule.positionMs() - (before + 4_000)) < 400 }
        val afterForward = rule.positionMs()
        assertTrue("forward should move by 4s, moved ${afterForward - before}", abs(afterForward - before - 4_000) < 400)
        rule.onNodeWithTag("skip-back").performClick()
        rule.waitUntil(5_000) { abs(rule.positionMs() - before) < 400 }

        // Speed: pick 1.5× and check the player's rate.
        rule.onNodeWithTag("speed-select").performClick()
        rule.onNodeWithTag("speed-select-1.5×").performClick()
        rule.waitUntil(5_000) { rule.onAllNodes(hasText("1.5×")).fetchSemanticsNodes().isNotEmpty() }
        val prefs = (rule.activity.application as ProjektorApp).container.playerPrefs.settings.value
        assertEquals(4, prefs.skipSeconds)
        assertEquals(1.5f, prefs.rate)
    }
}
