package app.projektor.mobile

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.projektor.core.api.models.LibraryKindInput
import app.projektor.mobile.download.DownloadState
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Needs the API on the host with the anime fixture scanned, a comic library holding a series under
 * a Manga folder and one outside it, and the admin "Izzan" created.
 */
@RunWith(AndroidJUnit4::class)
class DownloadTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val serverUrl = InstrumentationRegistry.getArguments().getString("serverUrl") ?: "http://10.0.2.2:8096"
    private val container get() = (rule.activity.application as ProjektorApp).container

    @Before
    fun signIn() {
        container.sessions.signOut()
        container.downloads.downloads.value.forEach { container.downloads.remove(it) }
        container.comicDownloads.downloads.value.forEach { container.comicDownloads.remove(it) }
        rule.onNodeWithTag("server-url").performTextClearance()
        rule.onNodeWithTag("server-url").performTextInput(serverUrl)
        rule.onNodeWithTag("server-continue").performClick()
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("profile-Izzan").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("profile-Izzan").performClick()
        rule.waitUntil(20_000) { rule.onAllNodesWithTag("tab-comics").fetchSemanticsNodes().isNotEmpty() }
    }

    @Test
    fun downloadsAnAnimeEpisodeWithItsSubtitlesAndFonts() {
        val items = container.items()!!
        // The fixture is a season-less show: its episodes hang off the show itself.
        val episode = runBlocking { items.detail(items.detail(items.list(libraryKind = LibraryKindInput.ANIME).items.first().id).children.first().id) }
        val file = episode.files.first()
        container.downloads.start(episode, file)
        rule.waitUntil(60_000) { container.downloads.get(episode.id)?.isActive == false }
        val d = container.downloads.get(episode.id)!!
        assertEquals(DownloadState.DONE, d.state)
        assertEquals(file.sizeBytes, d.bytes)
        assertTrue("the video is playable from the phone", container.downloads.playable(file.id) != null)
        assertEquals(file.subtitles.size, d.subtitles.size)
    }

    @Test
    fun downloadsAComic() {
        val repo = container.comics()!!
        val book = runBlocking { repo.seriesDetail(repo.series().first { it.title == "Batman" }.id).books.first() }
        container.comicDownloads.start(book)
        rule.waitUntil(30_000) { container.comicDownloads.get(book.id)?.isActive == false }
        assertEquals(DownloadState.DONE, container.comicDownloads.get(book.id)!!.state)
        assertTrue(container.comicDownloads.readable(book.id) != null)
    }

    @Test
    fun comicsTabSwitchesBetweenComicsAndManga() {
        rule.onNodeWithTag("tab-comics").performClick()
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("comics-shelf-manga").fetchSemanticsNodes().isNotEmpty() }
        fun shown(title: String) = rule.onAllNodesWithText(title).fetchSemanticsNodes().isNotEmpty()

        rule.onNodeWithTag("comics-shelf-all").performClick()
        rule.waitUntil(5_000) { shown("Batman") && shown("Test Manga") }
        rule.onNodeWithTag("comics-shelf-manga").performClick()
        rule.waitUntil(5_000) { shown("Test Manga") && !shown("Batman") }
        rule.onNodeWithTag("comics-shelf-comics").performClick()
        rule.waitUntil(5_000) { shown("Batman") && !shown("Test Manga") }
        rule.onNodeWithTag("comics-shelf-all").performClick()
    }
}
