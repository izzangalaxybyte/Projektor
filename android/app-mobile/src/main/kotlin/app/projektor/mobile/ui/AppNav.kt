package app.projektor.mobile.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.projektor.mobile.AppContainer
import app.projektor.mobile.ui.auth.SignInFlow
import app.projektor.mobile.ui.comics.ComicHistoryScreen
import app.projektor.mobile.ui.comics.ComicReaderScreen
import app.projektor.mobile.ui.comics.SeriesScreen
import app.projektor.mobile.ui.item.ItemScreen
import app.projektor.mobile.ui.live.CatchupPlayerScreen
import app.projektor.mobile.ui.live.LivePlayerScreen
import app.projektor.mobile.ui.live.ProviderSource
import app.projektor.mobile.ui.live.RecordingsScreen
import app.projektor.mobile.ui.player.PlayerScreen

object Routes {
    const val SIGN_IN = "sign-in"
    const val MAIN = "main"
    const val ITEM = "item/{id}"
    fun item(id: String) = "item/$id"
    const val PLAYER = "play/{fileId}?item={itemId}&t={startMs}"
    fun player(fileId: String, itemId: String, startMs: Long = 0) = "play/$fileId?item=$itemId&t=$startMs"
    const val LIVE = "live/{channelId}"
    fun live(channelId: String) = "live/$channelId"
    const val CATCHUP = "live/{channelId}/catchup/{programmeId}"
    fun catchup(channelId: String, programmeId: String) = "live/$channelId/catchup/$programmeId"
    const val RECORDINGS = "recordings"
    const val RECORDING_PLAYER = "recordings/{id}/watch"
    fun recordingPlayer(id: String) = "recordings/$id/watch"
    const val COMIC_SERIES = "comics/series/{id}"
    fun comicSeries(id: String) = "comics/series/$id"
    /** page -1: where the book was left off. */
    const val COMIC_READER = "comics/read/{id}?page={page}"
    fun comicReader(id: String, page: Int = -1) = "comics/read/$id?page=$page"
    const val COMIC_HISTORY = "comics/history"
}

/** Signed out shows the sign-in flow; signed in shows the tabs and detail/player destinations. */
@Composable
fun AppNav(container: AppContainer) {
    val session by container.sessions.session.collectAsState()
    if (session == null) {
        SignInFlow(container)
        return
    }
    val nav = rememberNavController()
    // A tapped download notification: back to the tabs, where MainScaffold opens Downloads.
    val openDownloads by container.openDownloads.collectAsState()
    LaunchedEffect(openDownloads) { if (openDownloads) nav.popBackStack(Routes.MAIN, inclusive = false) }
    NavHost(navController = nav, startDestination = Routes.MAIN) {
        composable(Routes.MAIN) {
            MainScaffold(
                container,
                openItem = { nav.navigate(Routes.item(it)) },
                openChannel = { nav.navigate(Routes.live(it)) },
                openRecordings = { nav.navigate(Routes.RECORDINGS) },
                play = { fileId, itemId, startMs -> nav.navigate(Routes.player(fileId, itemId, startMs)) },
                openComicSeries = { nav.navigate(Routes.comicSeries(it)) },
                openComic = { nav.navigate(Routes.comicReader(it)) },
                openComicHistory = { nav.navigate(Routes.COMIC_HISTORY) },
            )
        }
        composable(Routes.COMIC_SERIES, arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
            SeriesScreen(
                container = container,
                seriesId = entry.arguments?.getString("id") ?: return@composable,
                openBook = { nav.navigate(Routes.comicReader(it)) },
                back = { nav.popBackStack() },
            )
        }
        composable(Routes.COMIC_HISTORY) {
            ComicHistoryScreen(container, openBook = { nav.navigate(Routes.comicReader(it)) }, back = { nav.popBackStack() })
        }
        composable(
            Routes.COMIC_READER,
            arguments = listOf(navArgument("id") { type = NavType.StringType }, navArgument("page") { type = NavType.IntType; defaultValue = -1 }),
        ) { entry ->
            ComicReaderScreen(
                container = container,
                bookId = entry.arguments?.getString("id") ?: return@composable,
                startPage = entry.arguments?.getInt("page")?.takeIf { it >= 0 },
                // The next or previous book replaces this one, so Back leaves the reader.
                openBook = { next -> nav.navigate(Routes.comicReader(next)) { popUpTo(Routes.COMIC_READER) { inclusive = true } } },
                back = { nav.popBackStack() },
            )
        }
        composable(Routes.RECORDINGS) { RecordingsScreen(container, play = { nav.navigate(Routes.recordingPlayer(it)) }, back = { nav.popBackStack() }) }
        composable(Routes.RECORDING_PLAYER, arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
            CatchupPlayerScreen(container = container, source = ProviderSource.Recording(entry.arguments?.getString("id") ?: return@composable), back = { nav.popBackStack() })
        }
        composable(Routes.LIVE, arguments = listOf(navArgument("channelId") { type = NavType.StringType })) { entry ->
            LivePlayerScreen(
                container = container,
                channelId = entry.arguments?.getString("channelId") ?: return@composable,
                openCatchup = { c, p -> nav.navigate(Routes.catchup(c, p)) },
                back = { nav.popBackStack() },
            )
        }
        composable(Routes.CATCHUP, arguments = listOf(navArgument("channelId") { type = NavType.StringType }, navArgument("programmeId") { type = NavType.StringType })) { entry ->
            CatchupPlayerScreen(
                container = container,
                source = ProviderSource.Catchup(entry.arguments?.getString("channelId") ?: return@composable, entry.arguments?.getString("programmeId") ?: return@composable),
                back = { nav.popBackStack() },
            )
        }
        composable(Routes.ITEM, arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
            ItemScreen(
                container = container,
                itemId = entry.arguments?.getString("id") ?: return@composable,
                openItem = { nav.navigate(Routes.item(it)) },
                play = { fileId, itemId, startMs -> nav.navigate(Routes.player(fileId, itemId, startMs)) },
                back = { nav.popBackStack() },
            )
        }
        composable(
            Routes.PLAYER,
            arguments = listOf(
                navArgument("fileId") { type = NavType.StringType },
                navArgument("itemId") { type = NavType.StringType },
                navArgument("startMs") { type = NavType.LongType; defaultValue = 0L },
            ),
        ) { entry ->
            PlayerScreen(
                container = container,
                fileId = entry.arguments?.getString("fileId") ?: return@composable,
                itemId = entry.arguments?.getString("itemId") ?: return@composable,
                startMs = entry.arguments?.getLong("startMs") ?: 0L,
                playNext = { fileId, itemId -> nav.navigate(Routes.player(fileId, itemId)) { popUpTo(Routes.MAIN) } },
                back = { nav.popBackStack() },
            )
        }
    }
}
