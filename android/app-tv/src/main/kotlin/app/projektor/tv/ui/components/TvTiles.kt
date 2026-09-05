package app.projektor.tv.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Card
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import app.projektor.core.ProjektorClient
import app.projektor.core.api.models.ItemSummary
import app.projektor.tv.ui.captionFor
import coil3.compose.AsyncImage

fun ItemSummary.caption(): String = captionFor(kind.value, seasonNumber, episodeNumber, showTitle, year)

/** A focusable poster card: tv-material's Card scales and outlines itself on focus. */
@Composable
fun TvTile(item: ItemSummary, client: ProjektorClient, onClick: () -> Unit, modifier: Modifier = Modifier, focusRequester: FocusRequester? = null) {
    val wide = item.kind.value == "episode"
    val progress = item.progress?.takeIf { !it.watched }?.let { it.positionMs.toFloat() / it.durationMs.coerceAtLeast(1) }
    // Ask for focus from inside the tile so the request cannot run before the tile exists.
    if (focusRequester != null) LaunchedEffect(item.id) { runCatching { focusRequester.requestFocus() } }
    Column(modifier.width(if (wide) 300.dp else 160.dp)) {
        Card(
            onClick = onClick,
            modifier = Modifier.fillMaxWidth().aspectRatio(if (wide) 16f / 9f else 2f / 3f).testTag("tile-${item.kind.value}").let { m -> focusRequester?.let { m.focusRequester(it) } ?: m },
        ) {
            Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
                client.imageUrl(item.posterKey, if (wide) 780 else 300)?.let { AsyncImage(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
                    ?: Text(item.title.take(1), Modifier.align(Alignment.Center), style = MaterialTheme.typography.displayMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (progress != null) {
                    Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(4.dp).background(MaterialTheme.colorScheme.surfaceVariant)) {
                        Box(Modifier.fillMaxWidth(progress).fillMaxSize().background(MaterialTheme.colorScheme.primary))
                    }
                }
            }
        }
        Text(item.title, Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(item.caption(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A titled row of tiles. The first tile can take initial focus. */
@Composable
fun TvRow(title: String, items: List<ItemSummary>, client: ProjektorClient, onClick: (ItemSummary) -> Unit, testTag: String, firstFocus: FocusRequester? = null) {
    if (items.isEmpty()) return
    Column(Modifier.testTag(testTag)) {
        Text(title, Modifier.padding(start = 48.dp, bottom = 12.dp), style = MaterialTheme.typography.titleMedium)
        LazyRow(contentPadding = PaddingValues(horizontal = 48.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            items(items, key = { it.id }) { item ->
                TvTile(item, client, onClick = { onClick(item) }, focusRequester = if (item.id == items.first().id) firstFocus else null)
            }
        }
    }
}
