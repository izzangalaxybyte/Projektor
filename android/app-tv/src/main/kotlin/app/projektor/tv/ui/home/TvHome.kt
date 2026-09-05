package app.projektor.tv.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Tab
import androidx.tv.material3.TabRow
import androidx.tv.material3.Text
import app.projektor.core.api.models.ItemSummary
import app.projektor.core.api.models.LibraryKindInput
import app.projektor.tv.TvContainer
import app.projektor.tv.ui.UiState
import app.projektor.tv.ui.components.TvRow
import app.projektor.tv.ui.components.TvTile
import app.projektor.tv.ui.live.TvLive
import app.projektor.tv.ui.userMessage
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay

private val KINDS = listOf(LibraryKindInput.MOVIE, LibraryKindInput.TV, LibraryKindInput.ANIME)
private val LABEL = mapOf(LibraryKindInput.MOVIE to "Movies", LibraryKindInput.TV to "TV Shows", LibraryKindInput.ANIME to "Anime")
private val TABS = listOf("Home", "Movies", "TV Shows", "Anime", "Live", "Search")

/** Top tabs (D-pad left/right on the tab row) over the selected section. */
@Composable
fun TvHome(container: TvContainer, openItem: (String) -> Unit, openChannel: (String) -> Unit = {}, openRecordings: () -> Unit = {}) {
    var tab by rememberSaveable { mutableStateOf(0) }
    Column(Modifier.fillMaxSize().padding(top = 24.dp)) {
        TabRow(selectedTabIndex = tab, modifier = Modifier.padding(horizontal = 48.dp).testTag("tabs")) {
            TABS.forEachIndexed { i, label ->
                Tab(selected = tab == i, onFocus = { tab = i }, modifier = Modifier.testTag("tab-${label.lowercase().replace(' ', '-')}")) {
                    Text(label, Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
                }
            }
        }
        Column(Modifier.padding(top = 24.dp)) {
            when (tab) {
                0 -> HomeRows(container, openItem)
                1 -> KindGrid(container, LibraryKindInput.MOVIE, openItem)
                2 -> KindGrid(container, LibraryKindInput.TV, openItem)
                3 -> KindGrid(container, LibraryKindInput.ANIME, openItem)
                4 -> TvLive(container, openChannel, openRecordings)
                else -> TvSearch(container, openItem)
            }
        }
    }
}

data class HomeRows(val continueWatching: Map<LibraryKindInput, List<ItemSummary>>, val recent: Map<LibraryKindInput, List<ItemSummary>>)

@Composable
private fun HomeRows(container: TvContainer, openItem: (String) -> Unit) {
    val items = container.items() ?: return
    val client = container.client() ?: return
    var state by remember { mutableStateOf<UiState<HomeRows>>(UiState.Loading) }
    val firstFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        state = try {
            coroutineScope {
                val cont = KINDS.associateWith { k -> async { items.continueWatching(k) } }
                val recent = KINDS.associateWith { k -> async { items.recentlyAdded(k) } }
                UiState.Ready(HomeRows(cont.mapValues { it.value.await() }, recent.mapValues { it.value.await() }))
            }
        } catch (e: Exception) { UiState.Failed(e.userMessage()) }
    }
    when (val s = state) {
        UiState.Loading -> Text("Loading…", Modifier.padding(48.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        is UiState.Failed -> Text(s.message, Modifier.padding(48.dp), color = MaterialTheme.colorScheme.error)
        is UiState.Ready -> {
            val rows = buildList {
                KINDS.forEach { k -> s.value.continueWatching[k]?.takeIf { it.isNotEmpty() }?.let { add(Triple("Continue watching · ${LABEL[k]}", it, "continue-${k.value}")) } }
                KINDS.forEach { k -> s.value.recent[k]?.takeIf { it.isNotEmpty() }?.let { add(Triple("Recently added · ${LABEL[k]}", it, "recent-${k.value}")) } }
            }
            // The first tile of the first row requests focus itself (see TvTile).
            LazyColumn(verticalArrangement = Arrangement.spacedBy(28.dp), contentPadding = PaddingValues(bottom = 48.dp), modifier = Modifier.testTag("home")) {
                if (rows.isEmpty()) item { Text("Nothing here yet. Add a library on the server and scan it.", Modifier.padding(48.dp).testTag("home-empty"), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                rows.forEachIndexed { i, (title, list, tag) ->
                    item(key = tag) { TvRow(title, list, client, { openItem(it.id) }, tag, firstFocus = if (i == 0) firstFocus else null) }
                }
            }
        }
    }
}

@Composable
private fun KindGrid(container: TvContainer, kind: LibraryKindInput, openItem: (String) -> Unit) {
    val items = container.items() ?: return
    val client = container.client() ?: return
    var state by remember(kind) { mutableStateOf<UiState<List<ItemSummary>>>(UiState.Loading) }
    LaunchedEffect(kind) { state = try { UiState.Ready(items.list(libraryKind = kind, sort = "title", limit = 200).items) } catch (e: Exception) { UiState.Failed(e.userMessage()) } }
    when (val s = state) {
        UiState.Loading -> Text("Loading…", Modifier.padding(48.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        is UiState.Failed -> Text(s.message, Modifier.padding(48.dp), color = MaterialTheme.colorScheme.error)
        is UiState.Ready -> Grid(s.value, client, openItem)
    }
}

@Composable
fun Grid(list: List<ItemSummary>, client: app.projektor.core.ProjektorClient, openItem: (String) -> Unit) {
    if (list.isEmpty()) { Text("Nothing here yet.", Modifier.padding(48.dp), color = MaterialTheme.colorScheme.onSurfaceVariant); return }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(160.dp), contentPadding = PaddingValues(horizontal = 48.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(20.dp), verticalArrangement = Arrangement.spacedBy(24.dp), modifier = Modifier.testTag("grid"),
    ) {
        items(list, key = { it.id }) { item -> TvTile(item, client, onClick = { openItem(item.id) }) }
    }
}

@Composable
private fun TvSearch(container: TvContainer, openItem: (String) -> Unit) {
    val items = container.items() ?: return
    val client = container.client() ?: return
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<ItemSummary>>(emptyList()) }
    LaunchedEffect(query) {
        if (query.trim().length < 2) { results = emptyList(); return@LaunchedEffect }
        delay(300)
        results = runCatching { items.list(search = query.trim(), limit = 60).items }.getOrDefault(emptyList())
    }
    Column {
        Row(Modifier.fillMaxWidth().padding(horizontal = 48.dp)) {
            OutlinedTextField(value = query, onValueChange = { query = it }, singleLine = true, modifier = Modifier.fillMaxWidth(0.5f).testTag("search"), placeholder = { androidx.compose.material3.Text("Search titles") })
        }
        Grid(results, client, openItem)
    }
}
