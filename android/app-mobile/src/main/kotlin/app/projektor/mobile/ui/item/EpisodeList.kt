package app.projektor.mobile.ui.item

import android.content.Context
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.automirrored.filled.ViewList
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.FormatListNumbered
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.ViewAgenda
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.projektor.core.ProjektorClient
import app.projektor.core.api.models.ItemSummary
import coil3.compose.AsyncImage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

enum class EpisodeView(val label: String, val icon: ImageVector) {
    CARDS("Cards", Icons.Filled.ViewAgenda),
    LIST("List", Icons.AutoMirrored.Filled.ViewList),
    COMPACT("Compact", Icons.Filled.FormatListNumbered),
    GRID("Grid", Icons.Filled.GridView),
}

enum class EpisodeSort(val label: String) {
    NUMBER("Episode 1 → last"),
    NUMBER_DESC("Episode last → 1"),
    TITLE("Title A–Z"),
    UNWATCHED("Unwatched first"),
}

/** How episode lists are shown and sorted; remembered on the device for every show. */
class BrowsePrefs(context: Context) {
    private val prefs = context.getSharedPreferences("projektor.browse", Context.MODE_PRIVATE)
    private val _view = MutableStateFlow(enumOr(prefs.getString(KEY_VIEW, null), EpisodeView.CARDS))
    private val _sort = MutableStateFlow(enumOr(prefs.getString(KEY_SORT, null), EpisodeSort.NUMBER))
    val view: StateFlow<EpisodeView> = _view
    val sort: StateFlow<EpisodeSort> = _sort

    fun setView(value: EpisodeView) { prefs.edit().putString(KEY_VIEW, value.name).apply(); _view.value = value }
    fun setSort(value: EpisodeSort) { prefs.edit().putString(KEY_SORT, value.name).apply(); _sort.value = value }

    private companion object {
        const val KEY_VIEW = "episodeView"
        const val KEY_SORT = "episodeSort"
        inline fun <reified T : Enum<T>> enumOr(name: String?, default: T): T = enumValues<T>().firstOrNull { it.name == name } ?: default
    }
}

/** "24m", "1h 32m"; null when unknown. */
fun formatDuration(ms: Long?): String? {
    val minutes = (ms ?: return null) / 60_000
    if (minutes <= 0) return null
    return if (minutes >= 60) "${minutes / 60}h ${minutes % 60}m" else "${minutes}m"
}

fun sortEpisodes(items: List<ItemSummary>, sort: EpisodeSort): List<ItemSummary> {
    val byNumber = compareBy<ItemSummary>({ it.seasonNumber ?: Long.MAX_VALUE }, { it.episodeNumber ?: Long.MAX_VALUE })
    return when (sort) {
        EpisodeSort.NUMBER -> items.sortedWith(byNumber)
        EpisodeSort.NUMBER_DESC -> items.sortedWith(byNumber.reversed())
        EpisodeSort.TITLE -> items.sortedBy { it.title.lowercase() }
        EpisodeSort.UNWATCHED -> items.sortedWith(compareBy<ItemSummary> { it.progress?.watched == true }.then(byNumber))
    }
}

/** The Episodes heading with sort and view controls, then the episodes in the chosen layout. */
@Composable
fun EpisodeSection(items: List<ItemSummary>, client: ProjektorClient, prefs: BrowsePrefs, openItem: (String) -> Unit) {
    val view by prefs.view.collectAsState()
    val sort by prefs.sort.collectAsState()
    val sorted = remember(items, sort) { sortEpisodes(items, sort) }
    Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 24.dp).testTag("children")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Episodes", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Color.White, modifier = Modifier.weight(1f))
            var sortOpen by remember { mutableStateOf(false) }
            Box {
                TextButton(onClick = { sortOpen = true }, modifier = Modifier.testTag("episode-sort")) {
                    Icon(Icons.AutoMirrored.Filled.Sort, null, Modifier.size(18.dp))
                    Text(" ${sort.label}", style = MaterialTheme.typography.labelMedium)
                }
                DropdownMenu(expanded = sortOpen, onDismissRequest = { sortOpen = false }) {
                    EpisodeSort.entries.forEach { s ->
                        DropdownMenuItem(text = { Text(s.label) }, onClick = { sortOpen = false; prefs.setSort(s) }, modifier = Modifier.testTag("episode-sort-${s.name}"))
                    }
                }
            }
        }
        Row(Modifier.padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            EpisodeView.entries.forEach { v ->
                val selected = v == view
                IconButton(
                    onClick = { prefs.setView(v) },
                    modifier = Modifier.size(40.dp).clip(RoundedCornerShape(8.dp))
                        .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.2f) else Color.Transparent)
                        .testTag("episode-view-${v.name}"),
                ) { Icon(v.icon, v.label, tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
        when (view) {
            EpisodeView.CARDS -> Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                sorted.forEach { e -> EpisodeCard(e, client, Modifier.fillMaxWidth()) { openItem(e.id) } }
            }
            EpisodeView.GRID -> Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                sorted.chunked(2).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        row.forEach { e -> EpisodeCard(e, client, Modifier.weight(1f), compact = true) { openItem(e.id) } }
                        if (row.size == 1) Box(Modifier.weight(1f))
                    }
                }
            }
            EpisodeView.LIST -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                sorted.forEach { e -> EpisodeRow(e, client) { openItem(e.id) } }
            }
            EpisodeView.COMPACT -> Column {
                sorted.forEachIndexed { i, e ->
                    if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                    EpisodeLine(e) { openItem(e.id) }
                }
            }
        }
    }
}

private fun number(e: ItemSummary): String = listOfNotNull(e.seasonNumber?.let { "S$it" }, e.episodeNumber?.let { "E$it" }).joinToString(" ")

private fun progressOf(e: ItemSummary): Float? = e.progress?.takeIf { !it.watched && it.positionMs > 0 }?.let { it.positionMs.toFloat() / it.durationMs.coerceAtLeast(1) }

@Composable
private fun Thumb(e: ItemSummary, client: ProjektorClient, modifier: Modifier) {
    Box(modifier.aspectRatio(16f / 9f).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surface)) {
        client.imageUrl(e.posterKey, 780)?.let { AsyncImage(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
        formatDuration(e.runtimeMs)?.let {
            Text(it, style = MaterialTheme.typography.labelSmall, color = Color.White, modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp).background(Color.Black.copy(alpha = 0.7f), RoundedCornerShape(4.dp)).padding(horizontal = 5.dp, vertical = 1.dp))
        }
        if (e.progress?.watched == true) {
            Icon(Icons.Filled.CheckCircle, "Watched", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.align(Alignment.TopEnd).padding(6.dp).size(20.dp).background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(50)))
        }
        progressOf(e)?.let { p ->
            Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(3.dp).background(Color.Black.copy(alpha = 0.5f))) {
                Box(Modifier.fillMaxWidth(p).fillMaxHeight().background(MaterialTheme.colorScheme.primary))
            }
        }
    }
}

@Composable
private fun EpisodeCard(e: ItemSummary, client: ProjektorClient, modifier: Modifier, compact: Boolean = false, onClick: () -> Unit) {
    Column(modifier.clickable(onClick = onClick).testTag("tile-episode")) {
        Thumb(e, client, Modifier.fillMaxWidth())
        Text(e.title, style = if (compact) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.titleSmall, color = Color.White, maxLines = if (compact) 2 else 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
        Text(listOfNotNull(number(e).ifBlank { null }, formatDuration(e.runtimeMs)).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun EpisodeRow(e: ItemSummary, client: ProjektorClient, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).testTag("tile-episode"), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Thumb(e, client, Modifier.width(150.dp))
        Column(Modifier.weight(1f)) {
            Text(number(e), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            Text(e.title, style = MaterialTheme.typography.bodyMedium, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis)
            formatDuration(e.runtimeMs)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable
private fun EpisodeLine(e: ItemSummary, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 12.dp).testTag("tile-episode"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(e.episodeNumber?.toString() ?: "–", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.width(32.dp))
        Column(Modifier.weight(1f)) {
            Text(e.title, style = MaterialTheme.typography.bodyMedium, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
            progressOf(e)?.let { p ->
                Box(Modifier.padding(top = 4.dp).fillMaxWidth().height(2.dp).background(MaterialTheme.colorScheme.surfaceVariant)) {
                    Box(Modifier.fillMaxWidth(p).fillMaxHeight().background(MaterialTheme.colorScheme.primary))
                }
            }
        }
        formatDuration(e.runtimeMs)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (e.progress?.watched == true) Icon(Icons.Filled.CheckCircle, "Watched", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
    }
}
