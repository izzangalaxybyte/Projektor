package app.projektor.mobile.ui.comics

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.projektor.core.api.models.ComicBook
import app.projektor.mobile.AppContainer
import app.projektor.mobile.ui.userMessage
import kotlinx.coroutines.launch

private const val PAGE = 50

/** Every book opened, most recently read first; removing one clears its progress. */
@Composable
fun ComicHistoryScreen(container: AppContainer, openBook: (String) -> Unit, back: () -> Unit) {
    val repo = container.comics() ?: return
    val scope = rememberCoroutineScope()
    val books = remember { mutableStateListOf<ComicBook>() }
    var loading by remember { mutableStateOf(true) }
    var more by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    suspend fun loadMore() {
        loading = true
        try {
            val page = repo.history(offset = books.size, limit = PAGE)
            books += page
            more = page.size == PAGE
        } catch (e: Exception) { error = e.userMessage() }
        loading = false
    }
    LaunchedEffect(Unit) { loadMore() }

    LazyColumn(Modifier.fillMaxSize().testTag("comic-history"), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Row(Modifier.windowInsetsPadding(WindowInsets.statusBars).padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = back, modifier = Modifier.testTag("back")) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                Text("Reading history", style = MaterialTheme.typography.titleLarge)
            }
        }
        error?.let { item { Text(it, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error) } }
        if (!loading && books.isEmpty() && error == null) item {
            Text("Nothing read yet.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        items(books, key = { it.id }) { book ->
            Row(
                Modifier.fillMaxWidth().clickable { openBook(book.id) }.padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ComicCover(repo.coverUrl(book.coverKey), Modifier.width(56.dp), readFraction(book), book.progress?.finished == true)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(book.seriesTitle, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(listOfNotNull(book.label, book.title.takeIf { book.label == null }).joinToString(" · "), style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    val p = book.progress
                    Text(
                        listOfNotNull(
                            p?.let { if (it.finished) "Read" else "Page ${it.page + 1} of ${it.pageCount}" },
                            p?.updatedAt?.take(10),
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(onClick = {
                    scope.launch {
                        try {
                            repo.setRead(book.id, false)
                            books.remove(book)
                        } catch (e: Exception) { error = e.userMessage() }
                    }
                }) { Icon(Icons.Filled.Close, "Remove from history") }
            }
        }
        item {
            when {
                loading -> CircularProgressIndicator(Modifier.padding(24.dp))
                more && books.isNotEmpty() -> TextButton(onClick = { scope.launch { loadMore() } }, modifier = Modifier.padding(16.dp)) { Text("Load more") }
            }
        }
    }
}
