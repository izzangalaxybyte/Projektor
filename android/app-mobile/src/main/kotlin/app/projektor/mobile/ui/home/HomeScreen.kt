package app.projektor.mobile.ui.home

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.projektor.core.api.models.ItemSummary
import app.projektor.core.api.models.LibraryKindInput
import app.projektor.mobile.AppContainer
import app.projektor.mobile.BuildConfig
import app.projektor.mobile.ui.UiState
import app.projektor.mobile.ui.components.TileAction
import app.projektor.mobile.ui.components.TileRow
import app.projektor.mobile.ui.userMessage
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

data class HomeRows(val continueWatching: Map<LibraryKindInput, List<ItemSummary>>, val favorites: List<ItemSummary>, val recent: Map<LibraryKindInput, List<ItemSummary>>) {
    val isEmpty get() = continueWatching.values.all { it.isEmpty() } && favorites.isEmpty() && recent.values.all { it.isEmpty() }
}

private val KINDS = listOf(LibraryKindInput.MOVIE, LibraryKindInput.TV, LibraryKindInput.ANIME)
private val LABEL = mapOf(LibraryKindInput.MOVIE to "Movies", LibraryKindInput.TV to "TV Shows", LibraryKindInput.ANIME to "Anime")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(container: AppContainer, openItem: (String) -> Unit, modifier: Modifier = Modifier) {
    val items = container.items() ?: return
    val client = container.client() ?: return
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf<UiState<HomeRows>>(UiState.Loading) }
    var refreshing by remember { mutableStateOf(false) }
    suspend fun load() {
        state = try {
            coroutineScope {
                val cont = KINDS.associateWith { k -> async { items.continueWatching(k) } }
                val favorites = async { items.favorites() }
                val recent = KINDS.associateWith { k -> async { items.recentlyAdded(k) } }
                UiState.Ready(HomeRows(cont.mapValues { it.value.await() }, favorites.await(), recent.mapValues { it.value.await() }))
            }
        } catch (e: Exception) { UiState.Failed(e.userMessage()) }
    }
    LaunchedEffect(Unit) { load() }
    // Pull down to pick up changes made on another device (progress, favorites, new scans).
    fun refresh() = scope.launch { refreshing = true; load(); refreshing = false }

    // Watched state can be changed for movies and episodes; the rows reload to reflect it.
    fun setWatched(item: ItemSummary, watched: Boolean) = scope.launch {
        try {
            items.setWatched(item.id, watched)
            load()
        } catch (e: Exception) { Toast.makeText(context, e.userMessage(), Toast.LENGTH_SHORT).show() }
    }
    fun setFavorite(item: ItemSummary, favorite: Boolean) = scope.launch {
        try {
            items.setFavorite(item.id, favorite)
            load()
        } catch (e: Exception) { Toast.makeText(context, e.userMessage(), Toast.LENGTH_SHORT).show() }
    }
    fun actions(item: ItemSummary): List<TileAction> {
        val playable = item.kind.value == "movie" || item.kind.value == "episode"
        val favoritable = item.kind.value == "movie" || item.kind.value == "show"
        if (!playable && !favoritable) return emptyList()
        val p = item.progress
        return listOfNotNull(
            TileAction("Details") { openItem(item.id) },
            TileAction("Add to favorites") { setFavorite(item, true) }.takeIf { favoritable && !item.favorite },
            TileAction("Remove from favorites") { setFavorite(item, false) }.takeIf { favoritable && item.favorite },
            TileAction("Mark as watched") { setWatched(item, true) }.takeIf { playable && p?.watched != true },
            TileAction("Remove from Continue watching") { setWatched(item, false) }.takeIf { playable && p != null && !p.watched },
            TileAction("Mark as unwatched") { setWatched(item, false) }.takeIf { playable && p?.watched == true },
        )
    }
    PullToRefreshBox(isRefreshing = refreshing, onRefresh = { refresh() }, modifier = modifier.fillMaxSize().testTag("home-refresh")) {
        when (val s = state) {
            UiState.Loading -> CircularProgressIndicator(Modifier.padding(24.dp))
            is UiState.Failed -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                Text(s.message, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(24.dp))
            }
            is UiState.Ready -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                KINDS.forEach { k -> TileRow("Continue watching · ${LABEL[k]}", s.value.continueWatching[k].orEmpty(), client, { openItem(it.id) }, "continue-${k.value}", ::actions) }
                TileRow("Favorites", s.value.favorites, client, { openItem(it.id) }, "favorites", ::actions)
                KINDS.forEach { k -> TileRow("Recently added · ${LABEL[k]}", s.value.recent[k].orEmpty(), client, { openItem(it.id) }, "recent-${k.value}", ::actions) }
                if (s.value.isEmpty) Text("Nothing here yet. Add a library on the server and scan it.", Modifier.padding(24.dp).testTag("home-empty"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Projektor build ${BuildConfig.VERSION_NAME}", Modifier.padding(horizontal = 16.dp, vertical = 12.dp).testTag("build-number"), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
