package app.projektor.tv.ui.item

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Button
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import app.projektor.core.api.models.ItemDetail
import app.projektor.core.api.models.ItemSummary
import app.projektor.core.items.describeVersion
import app.projektor.tv.TvContainer
import app.projektor.tv.ui.UiState
import app.projektor.tv.ui.captionFor
import app.projektor.tv.ui.components.TvRow
import app.projektor.tv.ui.formatMs
import app.projektor.tv.ui.userMessage
import coil3.compose.AsyncImage

@Composable
fun TvItemScreen(container: TvContainer, itemId: String, openItem: (String) -> Unit, play: (fileId: String, itemId: String, startMs: Long) -> Unit, back: () -> Unit) {
    val items = container.items() ?: return
    val client = container.client() ?: return
    var state by remember(itemId) { mutableStateOf<UiState<Pair<ItemDetail, List<ItemSummary>>>>(UiState.Loading) }
    var next by remember(itemId) { mutableStateOf<ItemSummary?>(null) }
    val primaryFocus = remember { FocusRequester() }
    LaunchedEffect(itemId) {
        state = try {
            val d = items.detail(itemId)
            val children = if (d.kind.value == "show" || d.kind.value == "season") items.children(itemId) else emptyList()
            if (d.kind.value == "episode") next = runCatching { items.nextEpisode(itemId) }.getOrNull()
            UiState.Ready(d to children)
        } catch (e: Exception) { UiState.Failed(e.userMessage()) }
    }
    when (val s = state) {
        UiState.Loading -> Text("Loading…", Modifier.padding(48.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        is UiState.Failed -> Text(s.message, Modifier.padding(48.dp), color = MaterialTheme.colorScheme.error)
        is UiState.Ready -> {
            val (d, children) = s.value
            // Several files for one item (a sub and a dub release, say): ask which to play.
            var choosingFrom by remember(d.id) { mutableStateOf<Long?>(null) }
            fun start(fileId: String, at: Long) { if (d.files.size > 1) choosingFrom = at else play(fileId, d.id, at) }
            Box(Modifier.fillMaxSize()) {
                client.imageUrl(d.backdropKey, 1280)?.let { AsyncImage(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alpha = 0.25f) }
                LazyColumn(contentPadding = PaddingValues(vertical = 40.dp), verticalArrangement = Arrangement.spacedBy(28.dp)) {
                    item {
                        Row(Modifier.padding(horizontal = 48.dp), horizontalArrangement = Arrangement.spacedBy(32.dp)) {
                            Box(Modifier.width(200.dp).background(MaterialTheme.colorScheme.surface)) {
                                client.imageUrl(d.posterKey, 300)?.let { AsyncImage(it, null, Modifier.fillMaxWidth(), contentScale = ContentScale.FillWidth) }
                            }
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth(0.6f)) {
                                if (d.showTitle != null && d.kind.value != "show") Text(d.showTitle!!, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(d.title, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.testTag("item-title"))
                                val meta = listOfNotNull(captionFor(d.kind.value, d.seasonNumber, d.episodeNumber, d.showTitle, d.year).takeIf { it.isNotBlank() }, d.runtimeMs?.let { "${it / 60000} min" }, d.rating?.let { "★ %.1f".format(it) }).plus(d.genres).joinToString(" · ")
                                if (meta.isNotBlank()) Text(meta, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                d.overview?.let { Text(it, style = MaterialTheme.typography.bodyMedium, maxLines = 6) }
                                // Requested here, inside the composed item, so Play has focus as soon as it exists.
                                LaunchedEffect(d.id) { runCatching { primaryFocus.requestFocus() } }
                                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    val file = d.files.firstOrNull()
                                    val resume = d.progress?.takeIf { !it.watched && it.positionMs > 5000 }?.positionMs?.toLong() ?: 0L
                                    if (file != null) {
                                        Button(onClick = { start(file.id, resume) }, modifier = Modifier.focusRequester(primaryFocus).testTag("play")) {
                                            Text(if (resume > 0) "Resume from ${formatMs(resume)}" else "Play")
                                        }
                                        if (resume > 0) Button(onClick = { start(file.id, 0) }) { Text("Start over") }
                                    }
                                    Button(onClick = back, modifier = Modifier.testTag("back").let { if (file == null) it.focusRequester(primaryFocus) else it }) { Text("Back") }
                                }
                                next?.let { n -> Text("Next: ${n.caption()} ${n.title}", color = MaterialTheme.colorScheme.primary, modifier = Modifier.testTag("next")) }
                                d.files.firstOrNull()?.let { f ->
                                    Text(f.streams.joinToString(" · ") { st -> "${st.type.value}: ${st.codec}${st.language?.let { l -> " $l" } ?: ""}" }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("file-info"))
                                }
                            }
                        }
                    }
                    val seasons = children.filter { it.kind.value == "season" }
                    val episodes = children.filter { it.kind.value == "episode" }
                    if (seasons.isNotEmpty()) item { TvRow("Seasons", seasons, client, { openItem(it.id) }, "seasons") }
                    if (episodes.isNotEmpty()) item { TvRow("Episodes", episodes, client, { openItem(it.id) }, "episodes") }
                }
                choosingFrom?.let { at ->
                    BackHandler { choosingFrom = null }
                    val firstVersion = remember { FocusRequester() }
                    Column(
                        Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.85f)).padding(horizontal = 120.dp, vertical = 48.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text("Choose a version", style = MaterialTheme.typography.headlineSmall)
                        d.files.forEachIndexed { i, f ->
                            Button(
                                onClick = { choosingFrom = null; play(f.id, d.id, at) },
                                modifier = Modifier.fillMaxWidth().testTag("version-${f.id}").let { if (i == 0) it.focusRequester(firstVersion) else it },
                            ) {
                                Column {
                                    Text(f.fileName, maxLines = 2)
                                    Text(describeVersion(f), style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                        LaunchedEffect(Unit) { runCatching { firstVersion.requestFocus() } }
                    }
                }
            }
        }
    }
}

private fun ItemSummary.caption() = captionFor(kind.value, seasonNumber, episodeNumber, showTitle, year)
