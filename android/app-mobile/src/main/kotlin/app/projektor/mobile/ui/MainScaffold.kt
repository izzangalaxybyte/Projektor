package app.projektor.mobile.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LiveTv
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Sensors
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import app.projektor.core.api.models.LibraryKindInput
import app.projektor.mobile.AppContainer
import app.projektor.mobile.ui.home.HomeScreen
import app.projektor.mobile.ui.library.LibraryScreen
import app.projektor.mobile.ui.live.LiveScreen
import app.projektor.mobile.ui.search.SearchScreen

enum class Tab(val label: String, val icon: ImageVector) {
    Home("Home", Icons.Filled.Home),
    Movies("Movies", Icons.Filled.Movie),
    Tv("TV", Icons.Filled.LiveTv),
    Anime("Anime", Icons.Filled.Star),
    Live("Live", Icons.Filled.Sensors),
    Search("Search", Icons.Filled.Search),
}

/** Bottom tabs. Each tab keeps its own state while the app is alive. */
@Composable
fun MainScaffold(container: AppContainer, openItem: (String) -> Unit, openChannel: (String) -> Unit = {}) {
    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    Scaffold(
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = tab == t,
                        onClick = { tab = t },
                        icon = { Icon(t.icon, contentDescription = null) },
                        label = { Text(t.label) },
                        modifier = Modifier.testTag("tab-${t.name.lowercase()}"),
                    )
                }
            }
        },
    ) { padding ->
        val modifier = Modifier.padding(padding)
        when (tab) {
            Tab.Home -> HomeScreen(container, openItem, modifier)
            Tab.Movies -> LibraryScreen(container, LibraryKindInput.MOVIE, "Movies", openItem, modifier)
            Tab.Tv -> LibraryScreen(container, LibraryKindInput.TV, "TV Shows", openItem, modifier)
            Tab.Anime -> LibraryScreen(container, LibraryKindInput.ANIME, "Anime", openItem, modifier)
            Tab.Live -> LiveScreen(container, openChannel, modifier)
            Tab.Search -> SearchScreen(container, openItem, modifier)
        }
    }
}
