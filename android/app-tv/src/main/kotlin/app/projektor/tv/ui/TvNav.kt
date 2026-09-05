package app.projektor.tv.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.projektor.tv.TvContainer
import app.projektor.tv.ui.auth.TvSignIn
import app.projektor.tv.ui.home.TvHome
import app.projektor.tv.ui.item.TvItemScreen
import app.projektor.tv.ui.live.TvCatchupScreen
import app.projektor.tv.ui.live.TvLivePlayerScreen
import app.projektor.tv.ui.player.TvPlayerScreen

object Routes {
    const val HOME = "home"
    const val ITEM = "item/{id}"
    fun item(id: String) = "item/$id"
    const val PLAYER = "play/{fileId}?item={itemId}&t={startMs}"
    fun player(fileId: String, itemId: String, startMs: Long = 0) = "play/$fileId?item=$itemId&t=$startMs"
    const val LIVE = "live/{channelId}"
    fun live(channelId: String) = "live/$channelId"
    const val CATCHUP = "live/{channelId}/catchup/{programmeId}"
    fun catchup(channelId: String, programmeId: String) = "live/$channelId/catchup/$programmeId"
}

@Composable
fun TvNav(container: TvContainer) {
    val session by container.sessions.session.collectAsState()
    if (session == null) {
        TvSignIn(container)
        return
    }
    val nav = rememberNavController()
    NavHost(navController = nav, startDestination = Routes.HOME) {
        composable(Routes.HOME) { TvHome(container, openItem = { nav.navigate(Routes.item(it)) }, openChannel = { nav.navigate(Routes.live(it)) }) }
        composable(Routes.LIVE, arguments = listOf(navArgument("channelId") { type = NavType.StringType })) { entry ->
            TvLivePlayerScreen(
                container = container,
                channelId = entry.arguments?.getString("channelId") ?: return@composable,
                openCatchup = { c, p -> nav.navigate(Routes.catchup(c, p)) },
                back = { nav.popBackStack() },
            )
        }
        composable(Routes.CATCHUP, arguments = listOf(navArgument("channelId") { type = NavType.StringType }, navArgument("programmeId") { type = NavType.StringType })) { entry ->
            TvCatchupScreen(
                container = container,
                channelId = entry.arguments?.getString("channelId") ?: return@composable,
                programmeId = entry.arguments?.getString("programmeId") ?: return@composable,
                back = { nav.popBackStack() },
            )
        }
        composable(Routes.ITEM, arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
            TvItemScreen(
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
            TvPlayerScreen(
                container = container,
                fileId = entry.arguments?.getString("fileId") ?: return@composable,
                itemId = entry.arguments?.getString("itemId") ?: return@composable,
                startMs = entry.arguments?.getLong("startMs") ?: 0L,
                playNext = { fileId, itemId -> nav.navigate(Routes.player(fileId, itemId)) { popUpTo(Routes.HOME) } },
                back = { nav.popBackStack() },
            )
        }
    }
}
