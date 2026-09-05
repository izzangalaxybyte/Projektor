package app.projektor.mobile

import androidx.compose.ui.test.SemanticsNodeInteractionsProvider
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasText
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

/**
 * Needs the API on the host with the admin "Izzan"/1234 and IPTV pointed at the fake provider
 * (`node e2e/start-server.mjs` plus the seeding in docs/android.md).
 */
@RunWith(AndroidJUnit4::class)
class LiveTest {
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
    fun opensAChannelSwitchesAndPlaysCatchUpWithExactSkips() {
        rule.onNodeWithTag("server-url").performTextClearance()
        rule.onNodeWithTag("server-url").performTextInput(serverUrl)
        rule.onNodeWithTag("server-continue").performClick()
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("profile-Izzan").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("profile-Izzan").performClick()
        rule.onNodeWithTag("pin").performTextInput("1234")
        rule.onNodeWithTag("pin-submit").performClick()
        rule.waitUntil(20_000) { rule.onAllNodesWithTag("tab-live").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("tab-live").performClick()

        rule.waitUntil(20_000) { rule.onAllNodesWithTag("channel-1001").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("channel-1001").assert(hasText("Big Match", substring = true))
        rule.onNodeWithTag("category-20").performClick()
        rule.waitUntil(5_000) { rule.onAllNodesWithTag("channel-1001").fetchSemanticsNodes().isEmpty() }
        rule.onNodeWithTag("category-all").performClick()
        rule.waitUntil(5_000) { rule.onAllNodesWithTag("channel-1001").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("channel-1001").performClick()

        // Live: raw TS plays and the position moves.
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("channel-name").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("channel-name").assert(hasText("Sport One HD", substring = true))
        rule.waitUntil(30_000) { rule.onAllNodesWithTag("decision").fetchSemanticsNodes().isNotEmpty() && rule.onNodeWithTag("decision").fetchSemanticsNode().config.getOrNull(SemanticsProperties.Text)?.joinToString { it.text }?.contains("Live") == true }
        rule.waitUntil(40_000) { rule.positionMs() > 1_000 }
        rule.onNodeWithTag("now-title").assert(hasText("Big Match"))

        // Channel up, then back down.
        rule.onNodeWithTag("channel-up").performClick()
        rule.waitUntil(15_000) { rule.onNodeWithTag("channel-name").fetchSemanticsNode().config.getOrNull(SemanticsProperties.Text)?.joinToString { it.text }?.contains("News 24") == true }
        rule.onNodeWithTag("channel-down").performClick()
        rule.waitUntil(15_000) { rule.onNodeWithTag("channel-name").fetchSemanticsNode().config.getOrNull(SemanticsProperties.Text)?.joinToString { it.text }?.contains("Sport One HD") == true }

        // Guide → the finished programme has a Watch button → catch-up plays and skips exactly.
        rule.onNodeWithTag("guide-toggle").performClick()
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("catchup-play").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("catchup-play").performClick()
        rule.waitUntil(30_000) { rule.onAllNodesWithTag("catchup-title").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("catchup-title").assert(hasText("Earlier Match"))
        rule.waitUntil(40_000) { rule.positionMs() > 1_000 }
        rule.onNodeWithTag("toggle").performClick()
        Thread.sleep(700)
        rule.onNodeWithTag("skip-select").performClick()
        rule.onNodeWithTag("skip-select-+4s").performClick()
        rule.waitUntil(5_000) { rule.onAllNodes(hasText("Skip +4s")).fetchSemanticsNodes().isNotEmpty() }
        val before = rule.positionMs()
        rule.onNodeWithTag("skip-forward").performClick()
        rule.waitUntil(8_000) { abs(rule.positionMs() - (before + 4_000)) < 400 }
        val after = rule.positionMs()
        assertTrue("forward should move by 4s, moved ${after - before}", abs(after - before - 4_000) < 400)
        rule.onNodeWithTag("skip-back").performClick()
        rule.waitUntil(8_000) { abs(rule.positionMs() - before) < 400 }
    }
}
