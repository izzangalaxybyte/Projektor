package app.projektor.mobile.ui.comics

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.OfflinePin
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.projektor.core.api.models.ComicBook
import app.projektor.core.api.models.ComicSeries
import app.projektor.core.api.models.ReadingDirection
import app.projektor.core.comics.SeriesSort
import app.projektor.mobile.AppContainer
import app.projektor.mobile.ui.UiState
import app.projektor.mobile.ui.userMessage
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay

private data class ComicsHome(val reading: List<ComicBook>, val history: List<ComicBook>, val series: List<ComicSeries>)

/**
 * The tab as last loaded, for its sort and search. Opening a series leaves the tab's composition;
 * coming back, the grid is drawn from this at once instead of a spinner, so it keeps its scroll
 * position (a three-item loading grid would clamp it to the top) while a fresh copy loads.
 */
private var lastHome: Triple<SeriesSort, String, ComicsHome>? = null

/** Which shelf the tab shows; manga is whatever reads right to left (tagged, or under a Manga folder). */
private enum class Shelf(val label: String) {
    ALL("All"), COMICS("Comics"), MANGA("Manga");

    fun shows(direction: ReadingDirection?): Boolean = when (this) {
        ALL -> true
        COMICS -> direction != ReadingDirection.RTL
        MANGA -> direction == ReadingDirection.RTL
    }
}

/**
 * The Comics tab: continue reading, recently read, and every series, searchable, sortable, and
 * narrowed to comics or manga. Without the server it lists what is downloaded instead.
 */
@Composable
fun ComicsScreen(container: AppContainer, openSeries: (String) -> Unit, openBook: (String) -> Unit, openHistory: () -> Unit, modifier: Modifier = Modifier) {
    val repo = container.comics() ?: return
    var sort by rememberSaveable { mutableStateOf(SeriesSort.TITLE) }
    // Remembered across launches: someone reading mostly manga keeps seeing manga.
    val prefs = LocalContext.current.getSharedPreferences("projektor.comics", android.content.Context.MODE_PRIVATE)
    var shelf by remember { mutableStateOf(runCatching { Shelf.valueOf(prefs.getString(KEY_SHELF, null)!!) }.getOrDefault(Shelf.ALL)) }
    var search by rememberSaveable { mutableStateOf("") }
    var state by remember {
        mutableStateOf<UiState<ComicsHome>>(lastHome?.takeIf { it.first == sort && it.second == search }?.let { UiState.Ready(it.third) } ?: UiState.Loading)
    }
    LaunchedEffect(sort, search) {
        if (search.isNotEmpty()) delay(300)
        state = try {
            val home = ComicsHome(
                reading = if (search.isEmpty()) repo.continueReading() else emptyList(),
                history = if (search.isEmpty()) repo.history(limit = 12) else emptyList(),
                series = repo.series(search, sort),
            )
            container.comicProgress.flush(repo)
            lastHome = Triple(sort, search, home)
            UiState.Ready(home)
        } catch (e: Exception) { UiState.Failed(e.userMessage()) }
    }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(112.dp),
        modifier = modifier.fillMaxSize().testTag("comics"),
        contentPadding = PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Comics & manga", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.weight(1f))
                IconButton(onClick = openHistory, modifier = Modifier.testTag("comics-history")) { Icon(Icons.Filled.History, "Reading history") }
            }
        }
        item(span = { GridItemSpan(maxLineSpan) }) {
            OutlinedTextField(
                value = search,
                onValueChange = { search = it },
                singleLine = true,
                leadingIcon = { Icon(Icons.Filled.Search, null) },
                placeholder = { Text("Search series") },
                modifier = Modifier.fillMaxWidth().testTag("comics-search"),
            )
        }
        when (val s = state) {
            UiState.Loading -> item(span = { GridItemSpan(maxLineSpan) }) { Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
            is UiState.Failed -> item(span = { GridItemSpan(maxLineSpan) }) { OfflineComics(container, s.message, openBook) }
            is UiState.Ready -> {
                val home = s.value.let { h ->
                    ComicsHome(h.reading.filter { shelf.shows(it.direction) }, h.history.filter { shelf.shows(it.direction) }, h.series.filter { shelf.shows(it.direction) })
                }
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Shelf.entries.forEach { option ->
                            FilterChip(
                                selected = shelf == option,
                                onClick = { shelf = option; prefs.edit().putString(KEY_SHELF, option.name).apply() },
                                label = { Text(option.label) },
                                modifier = Modifier.testTag("comics-shelf-${option.name.lowercase()}"),
                            )
                        }
                    }
                }
                if (home.reading.isNotEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
                    BookRow("Continue reading", home.reading, container, openBook, "comics-continue")
                }
                if (home.history.isNotEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
                    BookRow("Recently read", home.history, container, openBook, "comics-recent", action = "See all" to openHistory)
                }
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SeriesSort.entries.forEach { option ->
                            FilterChip(
                                selected = sort == option,
                                onClick = { sort = option },
                                label = { Text(when (option) { SeriesSort.TITLE -> "A–Z"; SeriesSort.ADDED -> "Recently added"; SeriesSort.RECENT -> "Recently read" }) },
                                modifier = Modifier.testTag("comics-sort-${option.name.lowercase()}"),
                            )
                        }
                    }
                }
                if (home.series.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
                    Text(
                        when {
                            search.isNotEmpty() -> "No ${if (shelf == Shelf.ALL) "series" else shelf.label.lowercase()} match \"$search\"."
                            s.value.series.isNotEmpty() -> "No ${shelf.label.lowercase()} yet."
                            else -> "No comics yet. Add a Comics library on the server (Settings → Libraries) and scan it."
                        },
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                items(home.series, key = { it.id }) { series -> SeriesTile(series, container, onClick = { openSeries(series.id) }) }
            }
        }
    }
}

/** Shown when the server cannot be reached: the comics on the phone, ready to read. */
@Composable
private fun OfflineComics(container: AppContainer, message: String, openBook: (String) -> Unit) {
    val downloads by container.comicDownloads.downloads.collectAsState()
    val ready = downloads.filter { it.state == app.projektor.mobile.download.DownloadState.DONE }.sortedByDescending { it.addedAt }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Can't reach the server", style = MaterialTheme.typography.titleMedium)
        Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        if (ready.isNotEmpty()) {
            Text("Downloaded comics read without a connection:", color = MaterialTheme.colorScheme.onSurfaceVariant)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                items(ready, key = { it.bookId }) { d ->
                    BookTile(d.book, container.comicDownloads.coverOf(d), onClick = { openBook(d.bookId) }, downloaded = true)
                }
            }
        }
    }
}

@Composable
internal fun BookRow(title: String, books: List<ComicBook>, container: AppContainer, openBook: (String) -> Unit, tag: String, action: Pair<String, () -> Unit>? = null) {
    val repo = container.comics()
    val downloads by container.comicDownloads.downloads.collectAsState()
    Column(Modifier.testTag(tag)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            action?.let { (label, run) -> TextButton(onClick = run) { Text(label) } }
        }
        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(top = 8.dp)) {
            items(books, key = { it.id }) { book ->
                BookTile(book, repo?.coverUrl(book.coverKey), onClick = { openBook(book.id) }, downloaded = downloads.any { it.bookId == book.id && it.state == app.projektor.mobile.download.DownloadState.DONE })
            }
        }
    }
}

/** A book cover with its number, series and how far it has been read. */
@Composable
internal fun BookTile(book: ComicBook, cover: String?, onClick: () -> Unit, downloaded: Boolean = false, width: androidx.compose.ui.unit.Dp = 112.dp) {
    Column(Modifier.width(width).clickable(onClick = onClick).testTag("comic-book")) {
        ComicCover(cover, Modifier.fillMaxWidth(), readFraction(book), book.progress?.finished == true, downloaded)
        Text(book.label ?: book.title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
        Text(book.seriesTitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun SeriesTile(series: ComicSeries, container: AppContainer, onClick: () -> Unit) {
    Column(Modifier.clickable(onClick = onClick).testTag("comic-series")) {
        val fraction = if (series.bookCount > 0) series.readCount.toFloat() / series.bookCount else null
        ComicCover(container.comics()?.coverUrl(series.coverKey), Modifier.fillMaxWidth(), fraction?.takeIf { it > 0f && it < 1f }, series.readCount == series.bookCount && series.bookCount > 0)
        Text(series.title, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
        Text(
            listOfNotNull("${series.bookCount} book${if (series.bookCount == 1L) "" else "s"}", "${series.readCount} read".takeIf { series.readCount > 0 }).joinToString(" · "),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** A 2:3 cover with a read bar along the bottom and markers for read and downloaded. */
@Composable
internal fun ComicCover(model: Any?, modifier: Modifier, readFraction: Float?, finished: Boolean, downloaded: Boolean = false) {
    Box(modifier.aspectRatio(2f / 3f).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surface)) {
        if (model != null) AsyncImage(model, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Icon(Icons.AutoMirrored.Filled.MenuBook, null, Modifier.align(Alignment.Center).size(40.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.align(Alignment.TopEnd).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (downloaded) Icon(Icons.Filled.OfflinePin, "Downloaded", Modifier.size(20.dp).background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(50)), tint = MaterialTheme.colorScheme.primary)
            if (finished) Icon(Icons.Filled.CheckCircle, "Read", Modifier.size(20.dp).background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(50)), tint = MaterialTheme.colorScheme.primary)
        }
        readFraction?.let { p ->
            Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(4.dp).background(Color.Black.copy(alpha = 0.55f))) {
                Box(Modifier.fillMaxWidth(p).fillMaxHeight().background(MaterialTheme.colorScheme.primary))
            }
        }
    }
}

/** How far into a book its reader is, for the bar under the cover; null when unread or done. */
internal fun readFraction(book: ComicBook): Float? {
    val p = book.progress ?: return null
    if (p.finished || p.pageCount <= 0) return null
    return ((p.page + 1).toFloat() / p.pageCount).coerceIn(0.02f, 1f)
}

private const val KEY_SHELF = "shelf"
