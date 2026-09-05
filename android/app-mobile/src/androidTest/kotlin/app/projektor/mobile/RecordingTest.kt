package app.projektor.mobile

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
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Records a channel from the live player, stops it under Recordings, plays it, deletes it. */
@RunWith(AndroidJUnit4::class)
class RecordingTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val serverUrl = InstrumentationRegistry.getArguments().getString("serverUrl") ?: "http://10.0.2.2:8096"

    @Before
    fun signOut() { (rule.activity.application as ProjektorApp).container.sessions.signOut() }

    private fun textOf(tag: String): String = rule.onNodeWithTag(tag).fetchSemanticsNode().config.getOrNull(SemanticsProperties.Text)?.joinToString { it.text } ?: ""

    @Test
    fun recordsStopsPlaysAndDeletes() {
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
        rule.onNodeWithTag("channel-1001").performClick()
        rule.waitUntil(30_000) { (textOf("position-ms").toLongOrNull() ?: 0L) > 1_000 }

        rule.onNodeWithTag("record-now").performClick()
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("notice").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("notice").assert(hasText("Recording: Big Match"))
        Thread.sleep(3_000)
        rule.onNodeWithTag("back").performClick()
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("open-recordings").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("open-recordings").performClick()
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("stop").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("rec-state").assert(hasText("Recording…"))
        rule.onNodeWithTag("stop").performClick()
        rule.waitUntil(15_000) { textOf("rec-state") == "Done" }
        rule.onNodeWithTag("play").performClick()
        rule.waitUntil(30_000) { rule.onAllNodesWithTag("catchup-title").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("catchup-title").assert(hasText("Big Match"))
        rule.onNodeWithTag("decision").assert(hasText("Recording"))
        rule.waitUntil(40_000) { (textOf("position-ms").toLongOrNull() ?: 0L) > 1_000 }
        rule.onNodeWithTag("back").performClick()
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("delete").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("delete").performClick()
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("recording-list").fetchSemanticsNodes().isNotEmpty() && rule.onAllNodesWithTag("delete").fetchSemanticsNodes().isEmpty() }
    }
}
