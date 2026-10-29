package app.projektor.mobile.ui.comics

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.OfflinePin
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.projektor.core.api.models.ComicBook
import app.projektor.core.api.models.ComicSeriesDetail
import app.projektor.mobile.AppContainer
import app.projektor.mobile.comics.ComicDownload
import app.projektor.mobile.download.DownloadState
import app.projektor.mobile.ui.UiState
import app.projektor.mobile.ui.downloads.formatBytes
import app.projektor.mobile.ui.userMessage
import kotlinx.coroutines.launch

/** A series: its books in reading order (volumes, then the chapters after them), with progress. */
@Composable
fun SeriesScreen(container: AppContainer, seriesId: String, openBook: (String) -> Unit, back: () -> Unit) {
    val repo = container.comics() ?: return
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var state by remember(seriesId) { mutableStateOf<UiState<ComicSeriesDetail>>(UiState.Loading) }
    var reload by remember { mutableIntStateOf(0) }
    val downloads by container.comicDownloads.downloads.collectAsState()
    LaunchedEffect(seriesId, reload) {
        state = try { UiState.Ready(repo.seriesDetail(seriesId)) } catch (e: Exception) { UiState.Failed(e.userMessage()) }
    }
    fun toast(text: String) = android.widget.Toast.makeText(context, text, android.widget.Toast.LENGTH_SHORT).show()
    fun act(block: suspend () -> Unit) = scope.launch {
        try { block(); reload++ } catch (e: Exception) { toast(e.userMessage()) }
    }

    when (val s = state) {
        UiState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        is UiState.Failed -> Column(Modifier.windowInsetsPadding(WindowInsets.statusBars).padding(16.dp)) {
            IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text(s.message, color = MaterialTheme.colorScheme.error)
        }
        is UiState.Ready -> {
            val (series, books) = s.value.series to s.value.books
            // Pick up where the reader is: the last opened unfinished book, else the first unread.
            val resume = books.filter { it.progress != null && !it.progress!!.finished }.maxByOrNull { it.progress!!.updatedAt }
                ?: books.firstOrNull { it.progress?.finished != true && (it.pageCount ?: 0) > 0 }
            var menu by remember { mutableStateOf(false) }
            LazyColumn(Modifier.fillMaxSize().testTag("comic-series-screen"), contentPadding = PaddingValues(bottom = 24.dp)) {
                item {
                    Row(Modifier.windowInsetsPadding(WindowInsets.statusBars).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = back, modifier = Modifier.testTag("back")) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                        Spacer(Modifier.weight(1f))
                        Box {
                            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More") }
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                DropdownMenuItem(text = { Text("Mark all read") }, onClick = { menu = false; act { repo.setSeriesRead(seriesId, true) } })
                                DropdownMenuItem(text = { Text("Mark all unread") }, onClick = { menu = false; act { repo.setSeriesRead(seriesId, false) } })
                            }
                        }
                    }
                }
                item {
                    Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        ComicCover(repo.coverUrl(series.coverKey), Modifier.width(120.dp), null, series.readCount == series.bookCount)
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(series.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                            Text("${series.bookCount} book${if (series.bookCount == 1L) "" else "s"} · ${series.readCount} read", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (series.direction?.value == "rtl") Text("Manga · read right to left", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
                item {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        resume?.let { b ->
                            Button(onClick = { openBook(b.id) }, modifier = Modifier.fillMaxWidth().height(52.dp).testTag("comic-continue")) {
                                Icon(Icons.AutoMirrored.Filled.MenuBook, null)
                                Text(
                                    if (b.progress != null) " Continue ${b.label ?: b.title} · page ${b.progress!!.page + 1}" else " Read ${b.label ?: b.title}",
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                        val missing = books.filter { b -> downloads.none { it.bookId == b.id } && (b.pageCount ?: 0) > 0 }
                        if (missing.isNotEmpty()) OutlinedButton(
                            onClick = { missing.forEach { container.comicDownloads.start(it) }; toast("Downloading ${missing.size} books") },
                            modifier = Modifier.fillMaxWidth().testTag("comic-download-all"),
                        ) {
                            Icon(Icons.Filled.Download, null, tint = Color.White)
                            Text(" Download ${if (missing.size == books.size) "all" else "${missing.size} more"} · ${formatBytes(missing.sumOf { it.sizeBytes })}", color = Color.White)
                        }
                    }
                }
                items(books, key = { it.id }) { book ->
                    BookLine(
                        book,
                        repo.coverUrl(book.coverKey, 300),
                        downloads.firstOrNull { it.bookId == book.id },
                        open = { openBook(book.id) },
                        setRead = { read -> act { repo.setRead(book.id, read) } },
                        startDownload = { container.comicDownloads.start(book) },
                        removeDownload = { container.comicDownloads.remove(it) },
                        retryDownload = { container.comicDownloads.retry(it) },
                    )
                }
            }
        }
    }
}

/** One book in the series list: cover, number, title, pages, progress, and its download. */
@Composable
private fun BookLine(
    book: ComicBook,
    cover: String?,
    download: ComicDownload?,
    open: () -> Unit,
    setRead: (Boolean) -> Unit,
    startDownload: () -> Unit,
    removeDownload: (ComicDownload) -> Unit,
    retryDownload: (ComicDownload) -> Unit,
) {
    val readable = (book.pageCount ?: 0) > 0
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().clickable(enabled = readable, onClick = open).padding(horizontal = 16.dp, vertical = 8.dp).testTag("comic-book-line"),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ComicCover(cover, Modifier.width(56.dp), readFraction(book), book.progress?.finished == true, download?.state == DownloadState.DONE)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            book.label?.let { Text(it, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary) }
            Text(book.title, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val meta = when {
                book.indexError != null && !readable -> "Can't be read: ${book.indexError}"
                else -> listOfNotNull(
                    book.pageCount?.let { "$it pages" },
                    book.format?.value?.uppercase(),
                    formatBytes(book.sizeBytes),
                    book.progress?.let { p -> if (p.finished) "Read" else "Page ${p.page + 1} of ${p.pageCount}" },
                ).joinToString(" · ")
            }
            Text(meta, style = MaterialTheme.typography.bodySmall, color = if (readable) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error)
            if (download != null && download.isActive) LinearProgressIndicator(progress = { download.progress }, modifier = Modifier.fillMaxWidth().padding(top = 4.dp))
        }
        if (readable) ComicDownloadButton(download, start = startDownload, remove = removeDownload, retry = retryDownload)
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                if (book.progress?.finished == true) DropdownMenuItem(text = { Text("Mark unread") }, onClick = { menu = false; setRead(false) })
                else DropdownMenuItem(text = { Text("Mark read") }, onClick = { menu = false; setRead(true) })
                if (book.progress != null && book.progress?.finished != true) DropdownMenuItem(text = { Text("Remove from history") }, onClick = { menu = false; setRead(false) })
            }
        }
    }
}

/** Arrow to download, a filling ring while it comes down (tap to cancel), a pin once on the phone. */
@Composable
internal fun ComicDownloadButton(d: ComicDownload?, start: () -> Unit, remove: (ComicDownload) -> Unit, retry: (ComicDownload) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { if (d == null) start() else menu = true }, modifier = Modifier.testTag("comic-download")) {
            when {
                d == null -> Icon(Icons.Filled.Download, "Download", tint = Color.White)
                d.state == DownloadState.DONE -> Icon(Icons.Filled.OfflinePin, "Downloaded", tint = MaterialTheme.colorScheme.primary)
                d.state == DownloadState.FAILED -> Icon(Icons.Filled.ErrorOutline, "Download failed", tint = MaterialTheme.colorScheme.error)
                else -> Box(contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(progress = { d.progress }, modifier = Modifier.size(26.dp), strokeWidth = 2.5.dp, trackColor = Color.White.copy(alpha = 0.25f))
                    Icon(Icons.Filled.Stop, "Downloading", Modifier.size(12.dp), tint = Color.White)
                }
            }
        }
        if (d != null) DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            when (d.state) {
                DownloadState.DONE -> DropdownMenuItem(text = { Text("Delete download") }, onClick = { menu = false; remove(d) })
                DownloadState.FAILED -> {
                    DropdownMenuItem(text = { Text("Retry download") }, onClick = { menu = false; retry(d) })
                    DropdownMenuItem(text = { Text("Remove") }, onClick = { menu = false; remove(d) })
                }
                else -> DropdownMenuItem(text = { Text("Cancel download") }, onClick = { menu = false; remove(d) })
            }
        }
    }
}
