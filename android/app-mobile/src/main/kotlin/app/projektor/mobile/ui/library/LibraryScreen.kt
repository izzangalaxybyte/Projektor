package app.projektor.mobile.ui.library

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.projektor.core.api.models.ItemSummary
import app.projektor.core.api.models.LibraryKindInput
import app.projektor.mobile.AppContainer
import app.projektor.mobile.ui.UiState
import app.projektor.mobile.ui.components.PosterTile
import app.projektor.mobile.ui.userMessage

@Composable
fun LibraryScreen(container: AppContainer, kind: LibraryKindInput, title: String, openItem: (String) -> Unit, modifier: Modifier = Modifier) {
    val items = container.items() ?: return
    val client = container.client() ?: return
    var state by remember(kind) { mutableStateOf<UiState<List<ItemSummary>>>(UiState.Loading) }
    LaunchedEffect(kind) {
        state = try { UiState.Ready(items.list(libraryKind = kind, sort = "title", limit = 200).items) } catch (e: Exception) { UiState.Failed(e.userMessage()) }
    }
    when (val s = state) {
        UiState.Loading -> CircularProgressIndicator(modifier.padding(24.dp))
        is UiState.Failed -> Text(s.message, color = MaterialTheme.colorScheme.error, modifier = modifier.padding(24.dp))
        is UiState.Ready -> ItemGrid(title, s.value, client, openItem, modifier)
    }
}

@Composable
fun ItemGrid(title: String?, list: List<ItemSummary>, client: app.projektor.core.ProjektorClient, openItem: (String) -> Unit, modifier: Modifier = Modifier) {
    LazyVerticalGrid(
        columns = GridCells.Adaptive(120.dp),
        modifier = modifier.fillMaxSize().testTag("grid"),
        contentPadding = PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (title != null) item(span = { GridItemSpan(maxLineSpan) }) { Text(title, style = MaterialTheme.typography.headlineSmall) }
        if (list.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { Text("Nothing here yet.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        items(list, key = { it.id }, span = { if (it.kind.value == "episode") GridItemSpan(2) else GridItemSpan(1) }) { item ->
            PosterTile(item, client, onClick = { openItem(item.id) })
        }
    }
}
