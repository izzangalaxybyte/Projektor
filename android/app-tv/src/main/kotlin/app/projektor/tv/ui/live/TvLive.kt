package app.projektor.tv.ui.live

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Button
import androidx.tv.material3.Card
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import app.projektor.core.api.models.LiveCategory
import app.projektor.core.api.models.LiveChannel
import app.projektor.core.live.LiveGuide
import app.projektor.tv.TvContainer
import app.projektor.tv.ui.UiState
import app.projektor.tv.ui.userMessage
import coil3.compose.AsyncImage
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay

private data class LiveData(val configured: Boolean, val categories: List<LiveCategory>, val channels: List<LiveChannel>)

/** Live tab on the TV: a row of category buttons over a focusable channel list with now/next. */
@Composable
fun TvLive(container: TvContainer, openChannel: (String) -> Unit, openRecordings: () -> Unit = {}) {
    val live = container.live() ?: return
    var state by remember { mutableStateOf<UiState<LiveData>>(UiState.Loading) }
    var category by rememberSaveable { mutableStateOf<String?>(null) }
    val firstFocus = remember { FocusRequester() }
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
            delay(60_000)
        }
    }
    when (val s = state) {
        UiState.Loading -> Text("Loading…", Modifier.padding(48.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        is UiState.Failed -> Text(s.message, Modifier.padding(48.dp), color = MaterialTheme.colorScheme.error)
        is UiState.Ready -> {
            if (!s.value.configured) {
                Text("Live TV is not set up. Enter the IPTV login in the server's Settings.", Modifier.padding(48.dp).testTag("live-unconfigured"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                return
            }
            val list = s.value.channels.filter { category == null || it.categoryId == category }
            Column {
                LazyRow(contentPadding = PaddingValues(horizontal = 48.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    item { Button(onClick = { category = null }, modifier = Modifier.testTag("category-all")) { Text(if (category == null) "• All" else "All") } }
                    item { Button(onClick = openRecordings, modifier = Modifier.testTag("open-recordings")) { Text("Recordings") } }
                    items(s.value.categories, key = { it.id }) { c ->
                        Button(onClick = { category = c.id }, modifier = Modifier.testTag("category-${c.id}")) { Text(if (category == c.id) "• ${c.name}" else c.name) }
                    }
                }
                if (list.isEmpty()) Text("No channels yet.", Modifier.padding(48.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                LazyColumn(contentPadding = PaddingValues(horizontal = 48.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.testTag("channel-list")) {
                    items(list, key = { it.id }) { c ->
                        TvChannelRow(c, onClick = { openChannel(c.id) }, focusRequester = if (c.id == list.first().id) firstFocus else null)
                    }
                }
            }
        }
    }
}

@Composable
private fun TvChannelRow(c: LiveChannel, onClick: () -> Unit, focusRequester: FocusRequester?) {
    if (focusRequester != null) LaunchedEffect(c.id) { runCatching { focusRequester.requestFocus() } }
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth().testTag("channel-${c.id}").let { m -> focusRequester?.let { m.focusRequester(it) } ?: m }) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Box(Modifier.size(96.dp, 54.dp).background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
                if (c.logoUrl != null) AsyncImage(c.logoUrl, null, Modifier.size(96.dp, 54.dp), contentScale = ContentScale.Fit)
                else Text(c.number?.toString() ?: "·", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Column(Modifier.weight(1f)) {
                Text(listOfNotNull(c.number?.toString(), c.name).joinToString(" "), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val now = c.now
                if (now != null) {
                    Text("${LiveGuide.clock(now.startAt)} ${now.title}", style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Box(Modifier.fillMaxWidth(0.6f).height(4.dp).background(MaterialTheme.colorScheme.surfaceVariant)) {
                        Box(Modifier.fillMaxWidth(LiveGuide.progress(now.startAt, now.endAt)).fillMaxHeight().background(MaterialTheme.colorScheme.primary))
                    }
                    c.next?.let { Text("Next ${LiveGuide.clock(it.startAt)} · ${it.title}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                } else Text("No guide information", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (c.hasArchive) Text("Catch-up", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
