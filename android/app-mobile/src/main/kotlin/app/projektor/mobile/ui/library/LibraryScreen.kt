package app.projektor.mobile.ui.library

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.projektor.core.api.models.ItemFacets
import app.projektor.core.api.models.ItemSummary
import app.projektor.core.api.models.LibraryKindInput
import app.projektor.mobile.AppContainer
import app.projektor.mobile.ui.UiState
import app.projektor.mobile.ui.components.PosterTile
import app.projektor.mobile.ui.components.subtitle
import app.projektor.mobile.ui.userMessage

/** How the grid can be ordered: the server's sort, its label, and whether only anime has it. */
private enum class LibrarySort(val value: String, val label: String, val animeOnly: Boolean = false) {
    TITLE("title", "A–Z"),
    ADDED("added", "Recently added"),
    YEAR("year", "Newest"),
    RATING("rating", "Top rated"),
    ANILIST("anilist", "AniList score", animeOnly = true),
    MAL("mal", "MyAnimeList score", animeOnly = true),
    TMDB("tmdb", "TMDB score", animeOnly = true),
    POPULARITY("popularity", "Most popular", animeOnly = true),
}

private data class Query(val sort: LibrarySort, val filters: List<String>)

/**
 * What each library tab last showed. Opening a title leaves the tab's composition; coming back the
 * grid is drawn from this at once instead of a spinner, so it keeps its scroll position.
 */
private val lastShown = mutableMapOf<LibraryKindInput, Pair<Query, List<ItemSummary>>>()
private val lastFacets = mutableMapOf<LibraryKindInput, ItemFacets>()

/**
 * A library tab: every movie or show of one kind, narrowed by genres and tags and sorted by title,
 * date or audience score. Choices are remembered per tab across launches.
 */
@Composable
fun LibraryScreen(container: AppContainer, kind: LibraryKindInput, title: String, openItem: (String) -> Unit, modifier: Modifier = Modifier) {
    val items = container.items() ?: return
    val client = container.client() ?: return
    val prefs = LocalContext.current.getSharedPreferences("projektor.library", Context.MODE_PRIVATE)
    var query by remember(kind) {
        mutableStateOf(
            Query(
                sort = runCatching { LibrarySort.valueOf(prefs.getString("${kind.value}.sort", null)!!) }.getOrDefault(LibrarySort.TITLE),
                filters = prefs.getString("${kind.value}.filters", null)?.split('\n')?.filter { it.isNotBlank() }.orEmpty(),
            ),
        )
    }
    fun change(next: Query) {
        query = next
        prefs.edit().putString("${kind.value}.sort", next.sort.name).putString("${kind.value}.filters", next.filters.joinToString("\n")).apply()
    }
    var state by remember(kind) {
        mutableStateOf<UiState<List<ItemSummary>>>(lastShown[kind]?.takeIf { it.first == query }?.let { UiState.Ready(it.second) } ?: UiState.Loading)
    }
    var facets by remember(kind) { mutableStateOf(lastFacets[kind]) }
    LaunchedEffect(kind) {
        runCatching { items.facets(kind) }.onSuccess { facets = it; lastFacets[kind] = it }
    }
    LaunchedEffect(kind, query) {
        if (lastShown[kind]?.first != query) state = UiState.Loading
        state = try {
            val list = items.listAll(kind, query.sort.value, query.filters)
            lastShown[kind] = query to list
            UiState.Ready(list)
        } catch (e: Exception) { UiState.Failed(e.userMessage()) }
    }
    val sorts = LibrarySort.entries.filter { !it.animeOnly || kind == LibraryKindInput.ANIME }
    ItemGrid(
        title = title,
        list = (state as? UiState.Ready)?.value.orEmpty(),
        client = client,
        openItem = openItem,
        modifier = modifier,
        caption = { item -> captionFor(item, query.sort) },
        header = {
            Filters(query, sorts, facets, onChange = ::change)
            when (val s = state) {
                UiState.Loading -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                is UiState.Failed -> Text(s.message, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(vertical = 16.dp))
                is UiState.Ready -> if (query.filters.isNotEmpty()) {
                    Text("${s.value.size} title${if (s.value.size == 1) "" else "s"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        },
        empty = if (state is UiState.Ready) (if (query.filters.isEmpty()) "Nothing here yet." else "Nothing matches all of these.") else null,
    )
}

/** The sort menu, then genre chips and a Tags chip that opens every AniList tag. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Filters(query: Query, sorts: List<LibrarySort>, facets: ItemFacets?, onChange: (Query) -> Unit) {
    var sortMenu by remember { mutableStateOf(false) }
    var tagsOpen by remember { mutableStateOf(false) }
    fun toggle(name: String) = onChange(query.copy(filters = if (name in query.filters) query.filters - name else query.filters + name))
    Box {
        TextButton(onClick = { sortMenu = true }, modifier = Modifier.testTag("library-sort")) {
            Icon(Icons.AutoMirrored.Filled.Sort, null, Modifier.padding(end = 6.dp))
            Text(query.sort.label)
        }
        DropdownMenu(expanded = sortMenu, onDismissRequest = { sortMenu = false }) {
            sorts.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.label) },
                    onClick = { sortMenu = false; onChange(query.copy(sort = option)) },
                    modifier = Modifier.testTag("library-sort-${option.value}"),
                )
            }
        }
    }
    val genres = facets?.genres.orEmpty().map { it.name }
    val tags = facets?.tags.orEmpty().map { it.name }
    // Chosen tags show among the chips too, so what is filtering the grid is always in sight.
    val chips = query.filters.filter { it !in genres } + genres
    if (chips.isNotEmpty() || tags.isNotEmpty()) {
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(vertical = 4.dp)) {
            if (query.filters.isNotEmpty()) item {
                FilterChip(selected = false, onClick = { onChange(query.copy(filters = emptyList())) }, label = { Text("Clear") }, modifier = Modifier.testTag("library-clear"))
            }
            items(chips, key = { it }) { name ->
                FilterChip(selected = name in query.filters, onClick = { toggle(name) }, label = { Text(name) }, modifier = Modifier.testTag("genre-$name"))
            }
            if (tags.isNotEmpty()) item {
                FilterChip(selected = false, onClick = { tagsOpen = true }, label = { Text("More tags…") }, modifier = Modifier.testTag("library-tags"))
            }
        }
    }
    if (tagsOpen) {
        AlertDialog(
            onDismissRequest = { tagsOpen = false },
            confirmButton = { TextButton(onClick = { tagsOpen = false }) { Text("Done") } },
            title = { Text("Tags") },
            text = {
                FlowRow(
                    Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    tags.forEach { name -> FilterChip(selected = name in query.filters, onClick = { toggle(name) }, label = { Text(name) }) }
                }
            },
        )
    }
}

/** Under each poster: the score being sorted by, else the usual year or episode line. */
private fun captionFor(item: ItemSummary, sort: LibrarySort): String {
    val r = item.ratings
    fun star(score: Double?, source: String) = score?.let { "★ ${"%.1f".format(it)} $source" } ?: "No $source score"
    return when (sort) {
        LibrarySort.ANILIST -> star(r.anilist, "AniList")
        LibrarySort.MAL -> star(r.mal, "MAL")
        LibrarySort.TMDB -> star(r.tmdb, "TMDB")
        LibrarySort.RATING, LibrarySort.POPULARITY -> when {
            r.anilist != null -> star(r.anilist, "AniList")
            r.mal != null -> star(r.mal, "MAL")
            r.tmdb != null -> star(r.tmdb, if (item.libraryKind.value == "anime") "TMDB" else "")
            else -> item.subtitle()
        }.trim()
        else -> item.subtitle()
    }
}

@Composable
fun ItemGrid(
    title: String?,
    list: List<ItemSummary>,
    client: app.projektor.core.ProjektorClient,
    openItem: (String) -> Unit,
    modifier: Modifier = Modifier,
    caption: (ItemSummary) -> String = { it.subtitle() },
    header: (@Composable () -> Unit)? = null,
    empty: String? = "Nothing here yet.",
) {
    LazyVerticalGrid(
        columns = GridCells.Adaptive(120.dp),
        modifier = modifier.fillMaxSize().testTag("grid"),
        contentPadding = PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (title != null || header != null) item(span = { GridItemSpan(maxLineSpan) }, key = "header", contentType = "header") {
            androidx.compose.foundation.layout.Column {
                if (title != null) Row(verticalAlignment = Alignment.CenterVertically) { Text(title, style = MaterialTheme.typography.headlineSmall) }
                header?.invoke()
            }
        }
        if (list.isEmpty() && empty != null) item(span = { GridItemSpan(maxLineSpan) }) { Text(empty, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        items(list, key = { it.id }, span = { if (it.kind.value == "episode") GridItemSpan(2) else GridItemSpan(1) }) { item ->
            PosterTile(item, client, onClick = { openItem(item.id) }, caption = caption(item))
        }
    }
}
