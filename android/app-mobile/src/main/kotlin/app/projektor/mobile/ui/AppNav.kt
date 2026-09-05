package app.projektor.mobile.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.projektor.mobile.AppContainer
import app.projektor.mobile.ui.auth.SignInFlow
import app.projektor.mobile.ui.item.ItemScreen
import app.projektor.mobile.ui.player.PlayerScreen

object Routes {
    const val SIGN_IN = "sign-in"
    const val MAIN = "main"
    const val ITEM = "item/{id}"
    fun item(id: String) = "item/$id"
    const val PLAYER = "play/{fileId}?item={itemId}&t={startMs}"
    fun player(fileId: String, itemId: String, startMs: Long = 0) = "play/$fileId?item=$itemId&t=$startMs"
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
    NavHost(navController = nav, startDestination = Routes.MAIN) {
        composable(Routes.MAIN) { MainScaffold(container, openItem = { nav.navigate(Routes.item(it)) }) }
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
