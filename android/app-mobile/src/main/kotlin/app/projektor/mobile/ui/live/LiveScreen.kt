package app.projektor.mobile.ui.live

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.projektor.core.api.models.LiveCategory
import app.projektor.core.api.models.LiveChannel
import app.projektor.core.live.LiveGuide
import app.projektor.mobile.AppContainer
import app.projektor.mobile.ui.UiState
import app.projektor.mobile.ui.userMessage
import coil3.compose.AsyncImage
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay

data class LiveData(val configured: Boolean, val categories: List<LiveCategory>, val channels: List<LiveChannel>)

/** Live TV: category chips over the channel list with what is on now and next. */
@Composable
fun LiveScreen(container: AppContainer, openChannel: (String) -> Unit, modifier: Modifier = Modifier) {
    val live = container.live() ?: return
    var state by remember { mutableStateOf<UiState<LiveData>>(UiState.Loading) }
    var category by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        while (true) {
            state = try {
                coroutineScope {
                    val status = async { live.status() }
                    val cats = async { live.categories() }
                    val chans = async { live.channels() }
                    UiState.Ready(LiveData(status.await().configured, cats.await(), chans.await()))
                }
            } catch (e: Exception) { UiState.Failed(e.userMessage()) }
            delay(60_000) // now/next move on
        }
    }
    when (val s = state) {
        UiState.Loading -> CircularProgressIndicator(modifier.padding(24.dp))
        is UiState.Failed -> Text(s.message, color = MaterialTheme.colorScheme.error, modifier = modifier.padding(24.dp))
        is UiState.Ready -> Column(modifier.fillMaxSize()) {
            Text("Live TV", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(16.dp))
            if (!s.value.configured) {
                Text("Live TV is not set up. Enter the IPTV login in the server's Settings.", Modifier.padding(horizontal = 16.dp).testTag("live-unconfigured"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                return@Column
            }
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item { FilterChip(selected = category == null, onClick = { category = null }, label = { Text("All") }, modifier = Modifier.testTag("category-all")) }
                items(s.value.categories, key = { it.id }) { c ->
                    FilterChip(selected = category == c.id, onClick = { category = c.id }, label = { Text(c.name) }, modifier = Modifier.testTag("category-${c.id}"))
                }
            }
            val list = s.value.channels.filter { category == null || it.categoryId == category }
            if (list.isEmpty()) Text("No channels yet.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag("channel-list")) {
                items(list, key = { it.id }) { c -> ChannelRow(c) { openChannel(c.id) } }
            }
        }
    }
}

@Composable
fun ChannelRow(c: LiveChannel, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surface).clickable(onClick = onClick).padding(10.dp).testTag("channel-${c.id}"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(64.dp, 40.dp).clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
            if (c.logoUrl != null) AsyncImage(c.logoUrl, null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
            else Text(c.number?.toString() ?: "·", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(Modifier.weight(1f)) {
            Text(listOfNotNull(c.number?.toString(), c.name).joinToString(" "), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val now = c.now
            if (now != null) {
                Text("${LiveGuide.clock(now.startAt)} ${now.title}", style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Box(Modifier.fillMaxWidth(0.7f).height(3.dp).background(MaterialTheme.colorScheme.surfaceVariant)) {
                    Box(Modifier.fillMaxWidth(LiveGuide.progress(now.startAt, now.endAt)).fillMaxHeight().background(MaterialTheme.colorScheme.primary))
                }
                c.next?.let { Text("Next ${LiveGuide.clock(it.startAt)} · ${it.title}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            } else {
                Text("No guide information", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (c.hasArchive) Text("Catch-up", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
