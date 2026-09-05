package app.projektor.mobile

import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Needs the API on the host with the fixtures scanned and the admin "Izzan"/1234 created. */
@RunWith(AndroidJUnit4::class)
class BrowseTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val serverUrl = InstrumentationRegistry.getArguments().getString("serverUrl") ?: "http://10.0.2.2:8096"

    @Before
    fun signOut() {
        (rule.activity.application as ProjektorApp).container.sessions.signOut()
    }

    @Test
    fun signsInAndReachesAnEpisodeDetailFromHome() {
        rule.onNodeWithTag("server-url").performTextClearance()
        rule.onNodeWithTag("server-url").performTextInput(serverUrl)
        rule.onNodeWithTag("server-continue").performClick()
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("profile-Izzan").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("profile-Izzan").performClick()
        rule.onNodeWithTag("pin").performTextInput("1234")
        rule.onNodeWithTag("pin-submit").performClick()

        rule.waitUntil(20_000) { rule.onAllNodesWithTag("recent-tv").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("recent-movie").assertIsDisplayed()
        // Further down the page; existence is what matters.
        rule.onNodeWithTag("recent-anime").assertExists()
        rule.onNode(hasTestTag("recent-tv")).performClick()
        rule.onAllNodes(hasText("Sample Show")).onFirst().performClick()

        rule.waitUntil(15_000) { rule.onAllNodesWithTag("item-title").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("item-title").assert(hasText("Sample Show"))
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("tile-season").fetchSemanticsNodes().isNotEmpty() }
        rule.onAllNodesWithTag("tile-season").onFirst().performClick()
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("tile-episode").fetchSemanticsNodes().isNotEmpty() }
        rule.onAllNodesWithTag("tile-episode").onFirst().performClick()
        rule.waitUntil(15_000) { rule.onAllNodes(hasText("Episode 2")).fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("play").assertIsDisplayed()
        rule.onNodeWithText("video: hevc", substring = true).assertIsDisplayed()
    }

}
