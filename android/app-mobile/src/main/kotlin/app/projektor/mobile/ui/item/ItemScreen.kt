package app.projektor.mobile.ui.item

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.projektor.core.api.models.ItemDetail
import app.projektor.core.api.models.ItemSummary
import app.projektor.mobile.AppContainer
import app.projektor.mobile.ui.UiState
import app.projektor.mobile.ui.components.PosterTile
import app.projektor.mobile.ui.components.subtitle
import app.projektor.mobile.ui.userMessage
import coil3.compose.AsyncImage

fun formatMs(ms: Long): String {
    val total = ms / 1000
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

@Composable
fun ItemScreen(container: AppContainer, itemId: String, openItem: (String) -> Unit, play: (fileId: String, itemId: String, startMs: Long) -> Unit, back: () -> Unit) {
    val items = container.items() ?: return
    val client = container.client() ?: return
    var state by remember(itemId) { mutableStateOf<UiState<Pair<ItemDetail, List<ItemSummary>>>>(UiState.Loading) }
    var next by remember(itemId) { mutableStateOf<ItemSummary?>(null) }
    LaunchedEffect(itemId) {
        state = try {
            val d = items.detail(itemId)
            val children = if (d.kind.value == "show" || d.kind.value == "season") items.children(itemId) else emptyList()
            if (d.kind.value == "episode") next = runCatching { items.nextEpisode(itemId) }.getOrNull()
            UiState.Ready(d to children)
        } catch (e: Exception) { UiState.Failed(e.userMessage()) }
    }
    when (val s = state) {
        UiState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        is UiState.Failed -> Text(s.message, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(24.dp))
        is UiState.Ready -> {
            val (d, children) = s.value
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                Box(Modifier.fillMaxWidth().height(200.dp)) {
                    client.imageUrl(d.backdropKey, 1280)?.let { AsyncImage(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alpha = 0.4f) }
                    IconButton(onClick = back, modifier = Modifier.padding(8.dp).testTag("back")) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
                }
                Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Box(Modifier.width(110.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surface)) {
                        client.imageUrl(d.posterKey, 300)?.let { AsyncImage(it, null, Modifier.fillMaxWidth(), contentScale = ContentScale.FillWidth) }
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (d.showTitle != null && d.kind.value != "show") Text(d.showTitle!!, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(d.title, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.testTag("item-title"))
                        val meta = listOfNotNull(d.subtitle().takeIf { it.isNotBlank() }, d.runtimeMs?.let { "${it / 60000} min" }, d.rating?.let { "★ %.1f".format(it) }).plus(d.genres).joinToString(" · ")
                        if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        d.files.firstOrNull()?.let { file ->
                            val resume = d.progress?.takeIf { !it.watched && it.positionMs > 5000 }?.positionMs?.toLong() ?: 0L
                            Button(onClick = { play(file.id, d.id, resume) }, modifier = Modifier.testTag("play")) {
                                Icon(Icons.Filled.PlayArrow, null)
                                Text(if (resume > 0) " Resume from ${formatMs(resume)}" else " Play")
                            }
                            if (resume > 0) OutlinedButton(onClick = { play(file.id, d.id, 0) }) { Text("Start over") }
                        }
                    }
                }
                d.tagline?.let { Text(it, Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                d.overview?.let { Text(it, Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium) }
                next?.let { n ->
                    Text("Next: ${n.subtitle()} ${n.title}", Modifier.padding(horizontal = 16.dp).testTag("next"), color = MaterialTheme.colorScheme.primary)
                }
                val seasons = children.filter { it.kind.value == "season" }
                val episodes = children.filter { it.kind.value == "episode" }
                if (seasons.isNotEmpty()) TileSection("Seasons", seasons, client, openItem)
                if (episodes.isNotEmpty()) TileSection("Episodes", episodes, client, openItem)
                d.files.forEach { f ->
                    Column(Modifier.padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surface).padding(12.dp).testTag("file-info")) {
                        Text("${f.fileName} · ${f.container} · ${formatMs(f.durationMs.toLong())}", style = MaterialTheme.typography.bodySmall)
                        f.streams.forEach { st ->
                            Text("${st.type.value}: ${st.codec} ${st.language ?: ""} ${st.width?.let { w -> "${w}×${st.height}" } ?: ""}".trim(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        f.subtitles.forEach { sub -> Text("subtitle: ${sub.format} ${sub.language ?: ""} (${sub.source.value})", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            }
        }
    }
}

@Composable
private fun TileSection(title: String, list: List<ItemSummary>, client: app.projektor.core.ProjektorClient, openItem: (String) -> Unit) {
    Column(Modifier.padding(16.dp).testTag("children")) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        list.chunked(if (list.first().kind.value == "episode") 1 else 3).forEach { row ->
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                row.forEach { item -> PosterTile(item, client, onClick = { openItem(item.id) }, modifier = Modifier.weight(1f)) }
                repeat((if (row.first().kind.value == "episode") 1 else 3) - row.size) { Box(Modifier.weight(1f)) }
            }
        }
    }
}
