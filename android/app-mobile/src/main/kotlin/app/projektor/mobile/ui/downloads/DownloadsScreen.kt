package app.projektor.mobile.ui.downloads

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DownloadForOffline
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.projektor.mobile.AppContainer
import app.projektor.mobile.download.Download
import app.projektor.mobile.download.DownloadState
import app.projektor.mobile.download.DownloadStore
import coil3.compose.AsyncImage

/**
 * Everything on the phone, playable without the server: movies as rows, shows folded into one row
 * each that opens onto their episodes. Space used and free sits at the top.
 */
@Composable
fun DownloadsScreen(container: AppContainer, play: (fileId: String, itemId: String, startMs: Long) -> Unit, modifier: Modifier = Modifier) {
    val store = container.downloads
    val all by store.downloads.collectAsState()
    val movies = remember(all) { all.filter { it.showKey == null }.sortedByDescending { it.addedAt } }
    val shows = remember(all) {
        all.filter { it.showKey != null }.groupBy { it.showKey!! }.entries
            .sortedByDescending { e -> e.value.maxOf { it.addedAt } }
            .map { e -> e.key to e.value.sortedWith(compareBy({ it.detail.seasonNumber ?: Long.MAX_VALUE }, { it.detail.episodeNumber ?: Long.MAX_VALUE })) }
    }
    var expanded by rememberSaveable { mutableStateOf(setOf<String>()) }
    fun open(d: Download) {
        if (d.state != DownloadState.DONE) return
        play(d.file.id, d.itemId, resumeAt(d))
    }
    // Retrying needs the server; without it the row stays failed until there is a connection.
    fun retry(d: Download) { container.client()?.let { store.retry(it, d) } }

    LazyColumn(modifier.fillMaxSize().testTag("downloads"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        item {
            Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 8.dp)) {
                Text("Downloads", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, color = Color.White)
                if (all.isNotEmpty()) {
                    val (used, free) = remember(all) { store.storage() }
                    Text("${formatBytes(used)} used · ${formatBytes(free)} free on this phone", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    LinearProgressIndicator(
                        progress = { (used.toFloat() / (used + free).coerceAtLeast(1)).coerceIn(0f, 1f) },
                        modifier = Modifier.padding(top = 8.dp).fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)),
                        trackColor = MaterialTheme.colorScheme.surfaceVariant,
                    )
                }
            }
        }
        if (all.isEmpty()) item { EmptyDownloads() }
        items(movies, key = { it.itemId }) { d -> DownloadRow(d, store, ::open, ::retry) }
        shows.forEach { (title, episodes) ->
            item(key = "show-$title") {
                ShowRow(title, episodes, store, expanded = title in expanded) {
                    expanded = if (title in expanded) expanded - title else expanded + title
                }
            }
            if (title in expanded) items(episodes, key = { it.itemId }) { d -> DownloadRow(d, store, ::open, ::retry, indent = true) }
        }
    }
}

/** Where to start a download: its own saved spot, or the server's from when it was downloaded. */
private fun resumeAt(d: Download): Long {
    val pos = maxOf(d.positionMs, d.detail.progress?.takeIf { !it.watched }?.positionMs ?: 0L)
    return pos.takeIf { it > 5_000L && it < d.file.durationMs * 95 / 100 } ?: 0L
}

@Composable
private fun EmptyDownloads() {
    Column(Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 64.dp).testTag("downloads-empty"), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(Icons.Filled.DownloadForOffline, null, Modifier.size(72.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("Nothing downloaded yet", style = MaterialTheme.typography.titleMedium, color = Color.White)
        Text(
            "Tap the download button on a movie or episode to keep it on this phone, in full quality, ready to watch without a connection.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun ShowRow(title: String, episodes: List<Download>, store: DownloadStore, expanded: Boolean, toggle: () -> Unit) {
    val active = episodes.count { it.isActive }
    val size = episodes.sumOf { if (it.state == DownloadState.DONE) it.total else it.bytes }
    Row(Modifier.fillMaxWidth().clickable(onClick = toggle).padding(horizontal = 16.dp, vertical = 8.dp).testTag("download-show"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Artwork(store.imageOf(episodes.first()), Modifier.width(120.dp).aspectRatio(16f / 9f), progress = null)
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull("${episodes.size} episode${if (episodes.size == 1) "" else "s"}", formatBytes(size), "$active downloading".takeIf { active > 0 }).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Icon(if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, if (expanded) "Hide episodes" else "Show episodes", tint = Color.White)
    }
}

@Composable
private fun DownloadRow(d: Download, store: DownloadStore, open: (Download) -> Unit, retry: (Download) -> Unit, indent: Boolean = false) {
    val wide = d.isEpisode
    val watched = (d.positionMs.toFloat() / d.file.durationMs.coerceAtLeast(1)).takeIf { d.positionMs > 0 }?.coerceIn(0f, 1f)
    Row(
        Modifier.fillMaxWidth().clickable { open(d) }.padding(start = if (indent) 32.dp else 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp).testTag("download-row"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Artwork(store.imageOf(d), if (wide) Modifier.width(120.dp).aspectRatio(16f / 9f) else Modifier.width(64.dp).aspectRatio(2f / 3f), watched)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            if (wide) {
                val number = listOfNotNull(d.detail.seasonNumber?.let { "S$it" }, d.detail.episodeNumber?.let { "E$it" }).joinToString(" ")
                if (number.isNotEmpty()) Text(number, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            }
            Text(d.detail.title, style = MaterialTheme.typography.bodyMedium, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(statusText(d), d.detail.year?.toString()?.takeIf { !wide && d.state == DownloadState.DONE }).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = if (d.state == DownloadState.FAILED) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (d.isActive) LinearProgressIndicator(progress = { d.progress }, modifier = Modifier.padding(top = 4.dp).fillMaxWidth())
        }
        DownloadIcon(
            d,
            onStart = {},
            onRemove = store::remove,
            onRetry = retry,
            onPlay = open,
        )
    }
}

@Composable
private fun Artwork(url: String?, modifier: Modifier, progress: Float?) {
    Box(modifier.clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surface)) {
        url?.let { AsyncImage(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
        progress?.let { p ->
            Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(3.dp).background(Color.Black.copy(alpha = 0.5f))) {
                Box(Modifier.fillMaxWidth(p).fillMaxHeight().background(MaterialTheme.colorScheme.primary))
            }
        }
    }
}
