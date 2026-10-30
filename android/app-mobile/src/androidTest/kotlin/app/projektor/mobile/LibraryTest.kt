package app.projektor.mobile

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Needs the API on the host with the anime fixture scanned and given the genres Romance and
 * Comedy and a MAL score of 8.12, a comic library with 40 series under a Manga folder, and the
 * admin "Izzan" created.
 */
@RunWith(AndroidJUnit4::class)
class LibraryTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val serverUrl = InstrumentationRegistry.getArguments().getString("serverUrl") ?: "http://10.0.2.2:8096"

    @Before
    fun signIn() {
        val app = rule.activity.application as ProjektorApp
        app.container.sessions.signOut()
        app.getSharedPreferences("projektor.library", 0).edit().clear().commit()
        rule.onNodeWithTag("server-url").performTextClearance()
        rule.onNodeWithTag("server-url").performTextInput(serverUrl)
        rule.onNodeWithTag("server-continue").performClick()
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("profile-Izzan").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("profile-Izzan").performClick()
        rule.waitUntil(20_000) { rule.onAllNodesWithTag("tab-anime").fetchSemanticsNodes().isNotEmpty() }
    }

    private fun waitFor(text: String, substring: Boolean = false) =
        rule.waitUntil(10_000) { rule.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty() }

    @Test
    fun animeFiltersByGenreAndSortsByAnAudienceScore() {
        rule.onNodeWithTag("tab-anime").performClick()
        rule.waitUntil(10_000) { rule.onAllNodesWithTag("genre-Romance").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("genre-Romance").performClick()
        waitFor("Sample Anime")
        rule.onNodeWithText("1 title").assertIsDisplayed()

        rule.onNodeWithTag("library-sort").performClick()
        rule.onNodeWithTag("library-sort-mal").performClick()
        waitFor("★ 8.1 MAL")

        // A genre it does not have empties the grid; Clear brings it back.
        rule.onNodeWithTag("genre-Comedy").performClick()
        waitFor("Sample Anime")
        rule.onNodeWithTag("library-clear").performClick()
        rule.waitUntil(10_000) { rule.onAllNodesWithText("Clear").fetchSemanticsNodes().isEmpty() }
        waitFor("Sample Anime")
    }

    @Test
    fun mangaShelfKeepsItsPlaceAfterOpeningASeries() {
        rule.onNodeWithTag("tab-comics").performClick()
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("comics-shelf-manga").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("comics-shelf-manga").performClick()
        waitFor("Series 01")
        rule.onNodeWithTag("comics").performScrollToIndex(40)
        waitFor("Series 38")
        rule.onNodeWithText("Series 38").performClick()
        rule.waitUntil(10_000) { rule.onAllNodesWithTag("comics").fetchSemanticsNodes().isEmpty() }
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitUntil(10_000) { rule.onAllNodesWithTag("comics").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithText("Series 38").assertIsDisplayed()
        rule.onNodeWithTag("comics-search").assertDoesNotExist()
    }
}
