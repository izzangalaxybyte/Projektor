package app.projektor.mobile.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import app.projektor.mobile.BuildConfig
import app.projektor.mobile.ui.UiState
import app.projektor.mobile.ui.components.TileRow
import app.projektor.mobile.ui.userMessage
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

data class HomeRows(val continueWatching: Map<LibraryKindInput, List<ItemSummary>>, val recent: Map<LibraryKindInput, List<ItemSummary>>) {
    val isEmpty get() = continueWatching.values.all { it.isEmpty() } && recent.values.all { it.isEmpty() }
}

private val KINDS = listOf(LibraryKindInput.MOVIE, LibraryKindInput.TV, LibraryKindInput.ANIME)
private val LABEL = mapOf(LibraryKindInput.MOVIE to "Movies", LibraryKindInput.TV to "TV Shows", LibraryKindInput.ANIME to "Anime")

@Composable
fun HomeScreen(container: AppContainer, openItem: (String) -> Unit, modifier: Modifier = Modifier) {
    val items = container.items() ?: return
    val client = container.client() ?: return
    var state by remember { mutableStateOf<UiState<HomeRows>>(UiState.Loading) }
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
        UiState.Loading -> CircularProgressIndicator(modifier.padding(24.dp))
        is UiState.Failed -> Text(s.message, color = MaterialTheme.colorScheme.error, modifier = modifier.padding(24.dp))
        is UiState.Ready -> Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            KINDS.forEach { k -> TileRow("Continue watching · ${LABEL[k]}", s.value.continueWatching[k].orEmpty(), client, { openItem(it.id) }, "continue-${k.value}") }
            KINDS.forEach { k -> TileRow("Recently added · ${LABEL[k]}", s.value.recent[k].orEmpty(), client, { openItem(it.id) }, "recent-${k.value}") }
            if (s.value.isEmpty) Text("Nothing here yet. Add a library on the server and scan it.", Modifier.padding(24.dp).testTag("home-empty"), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Projektor build ${BuildConfig.VERSION_NAME}", Modifier.padding(horizontal = 16.dp, vertical = 12.dp).testTag("build-number"), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
