package app.projektor.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.projektor.core.ProjektorClient
import app.projektor.core.api.models.ItemDetail
import app.projektor.core.api.models.ItemSummary
import coil3.compose.AsyncImage

/** "S1 E2 · Show" for episodes, the year otherwise. */
fun captionFor(kind: String, seasonNumber: Long?, episodeNumber: Long?, showTitle: String?, year: Long?): String = when (kind) {
    "episode" -> buildString {
        seasonNumber?.let { append("S$it ") }
        append("E${episodeNumber ?: "?"}")
        showTitle?.let { append(" · $it") }
    }
    "season" -> showTitle ?: ""
    else -> year?.toString() ?: ""
}

fun ItemSummary.subtitle(): String = captionFor(kind.value, seasonNumber, episodeNumber, showTitle, year)
fun ItemDetail.subtitle(): String = captionFor(kind.value, seasonNumber, episodeNumber, showTitle, year)

/** An entry in a tile's three-dot menu. */
data class TileAction(val label: String, val run: () -> Unit)

@Composable
fun PosterTile(item: ItemSummary, client: ProjektorClient, onClick: () -> Unit, modifier: Modifier = Modifier, wide: Boolean = item.kind.value == "episode", actions: List<TileAction> = emptyList()) {
    val progress = item.progress?.takeIf { !it.watched }?.let { it.positionMs.toFloat() / it.durationMs.coerceAtLeast(1) }
    Column(modifier.clickable(onClick = onClick).testTag("tile-${item.kind.value}")) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(if (wide) 16f / 9f else 2f / 3f).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surface),
        ) {
            val url = client.imageUrl(item.posterKey, if (wide) 780 else 300)
            if (url != null) {
                AsyncImage(model = url, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
            } else {
                Text(item.title.take(1), Modifier.align(Alignment.Center), style = MaterialTheme.typography.headlineLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (progress != null) {
                Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(3.dp).background(MaterialTheme.colorScheme.surfaceVariant)) {
                    Box(Modifier.fillMaxWidth(progress).fillMaxSize().background(MaterialTheme.colorScheme.primary))
                }
            }
        }
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(item.title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
                Text(item.subtitle(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (actions.isNotEmpty()) {
                var open by remember { mutableStateOf(false) }
                Box {
                    IconButton(onClick = { open = true }, modifier = Modifier.size(36.dp).testTag("tile-menu")) {
                        Icon(Icons.Filled.MoreVert, "More options", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                        actions.forEach { a -> DropdownMenuItem(text = { Text(a.label) }, onClick = { open = false; a.run() }, modifier = Modifier.testTag("tile-action-${a.label}")) }
                    }
                }
            }
        }
    }
}

/** A titled horizontal strip; renders nothing while empty. */
@Composable
fun TileRow(title: String, items: List<ItemSummary>, client: ProjektorClient, onClick: (ItemSummary) -> Unit, testTag: String, actions: (ItemSummary) -> List<TileAction> = { emptyList() }) {
    if (items.isEmpty()) return
    Column(Modifier.testTag(testTag)) {
        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(items, key = { it.id }) { item ->
                val wide = item.kind.value == "episode"
                PosterTile(item, client, onClick = { onClick(item) }, modifier = Modifier.width(if (wide) 240.dp else 130.dp), wide = wide, actions = actions(item))
            }
        }
    }
}
