package app.projektor.mobile.ui.item

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.projektor.core.api.models.ItemDetail
import app.projektor.core.api.models.ItemSummary
import app.projektor.core.api.models.MediaFile
import app.projektor.core.items.describeVersion
import app.projektor.mobile.AppContainer
import app.projektor.mobile.ui.Bg
import app.projektor.mobile.ui.Surface2
import app.projektor.mobile.ui.UiState
import app.projektor.mobile.ui.components.PosterTile
import app.projektor.mobile.ui.components.subtitle
import app.projektor.mobile.ui.userMessage
import coil3.compose.AsyncImage
import java.util.Locale
import kotlinx.coroutines.launch

fun formatMs(ms: Long): String {
    val total = ms / 1000
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ItemScreen(container: AppContainer, itemId: String, openItem: (String) -> Unit, play: (fileId: String, itemId: String, startMs: Long) -> Unit, back: () -> Unit) {
    val items = container.items() ?: return
    val client = container.client() ?: return
    var state by remember(itemId) { mutableStateOf<UiState<Pair<ItemDetail, List<ItemSummary>>>>(UiState.Loading) }
    var next by remember(itemId) { mutableStateOf<ItemSummary?>(null) }
    var favorite by remember(itemId) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    fun toggleFavorite() = scope.launch {
        val want = !favorite
        favorite = want
        try { items.setFavorite(itemId, want) } catch (e: Exception) {
            favorite = !want
            android.widget.Toast.makeText(context, e.userMessage(), android.widget.Toast.LENGTH_SHORT).show()
        }
    }
    LaunchedEffect(itemId) {
        state = try {
            val d = items.detail(itemId)
            val children = if (d.kind.value == "show" || d.kind.value == "season") items.children(itemId) else emptyList()
            if (d.kind.value == "episode") next = runCatching { items.nextEpisode(itemId) }.getOrNull()
            favorite = d.favorite
            UiState.Ready(d to children)
        } catch (e: Exception) { UiState.Failed(e.userMessage()) }
    }
    when (val s = state) {
        UiState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        is UiState.Failed -> Text(s.message, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(24.dp))
        is UiState.Ready -> {
            val (d, children) = s.value
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                // Backdrop fading into the page, with the back button clear of the status bar.
                Box(Modifier.fillMaxWidth().height(240.dp)) {
                    client.imageUrl(d.backdropKey, 1280)?.let { AsyncImage(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
                    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0f to Bg.copy(alpha = 0.35f), 0.5f to Color.Transparent, 1f to Bg)))
                    IconButton(
                        onClick = back,
                        modifier = Modifier.windowInsetsPadding(WindowInsets.statusBars).padding(8.dp).background(Color.Black.copy(alpha = 0.45f), CircleShape).testTag("back"),
                    ) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Color.White) }
                    if (d.kind.value == "movie" || d.kind.value == "show") IconButton(
                        onClick = { toggleFavorite() },
                        modifier = Modifier.align(Alignment.TopEnd).windowInsetsPadding(WindowInsets.statusBars).padding(8.dp).background(Color.Black.copy(alpha = 0.45f), CircleShape).testTag("favorite"),
                    ) {
                        Icon(
                            if (favorite) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                            if (favorite) "Remove from favorites" else "Add to favorites",
                            tint = if (favorite) MaterialTheme.colorScheme.primary else Color.White,
                        )
                    }
                }
                Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Box(Modifier.width(112.dp).clip(RoundedCornerShape(10.dp)).background(MaterialTheme.colorScheme.surface)) {
                        client.imageUrl(d.posterKey, 300)?.let { AsyncImage(it, null, Modifier.fillMaxWidth(), contentScale = ContentScale.FillWidth) }
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (d.showTitle != null && d.kind.value != "show") Text(d.showTitle!!, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                        Text(d.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, color = Color.White, modifier = Modifier.testTag("item-title"))
                        val meta = listOfNotNull(d.subtitle().takeIf { it.isNotBlank() }, d.runtimeMs?.let { formatRuntime(it.toLong()) }).joinToString(" · ")
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.8f))
                            d.rating?.let { Text("★ %.1f".format(it), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary) }
                        }
                    }
                }
                if (d.genres.isNotEmpty()) {
                    FlowRow(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        d.genres.forEach { g ->
                            Text(g, style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.85f), modifier = Modifier.clip(RoundedCornerShape(50)).background(Surface2).padding(horizontal = 12.dp, vertical = 6.dp))
                        }
                    }
                }
                d.files.firstOrNull()?.let { file ->
                    val resume = d.progress?.takeIf { !it.watched && it.positionMs > 5000 }?.positionMs?.toLong() ?: 0L
                    // Several files for one item (a sub and a dub release, say): ask which to play.
                    var choosingFrom by remember(d.id) { mutableStateOf<Long?>(null) }
                    fun start(at: Long) { if (d.files.size > 1) choosingFrom = at else play(file.id, d.id, at) }
                    Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { start(resume) }, modifier = Modifier.fillMaxWidth().height(52.dp).testTag("play")) {
                            Icon(Icons.Filled.PlayArrow, null)
                            Text(if (resume > 0) " Resume from ${formatMs(resume)}" else " Play", style = MaterialTheme.typography.titleMedium)
                        }
                        if (resume > 0) OutlinedButton(onClick = { start(0) }, modifier = Modifier.fillMaxWidth()) { Text("Start over", color = Color.White) }
                        if (d.files.size > 1) Text("${d.files.size} versions available", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    choosingFrom?.let { at ->
                        VersionDialog(d.files, onDismiss = { choosingFrom = null }) { chosen -> choosingFrom = null; play(chosen.id, d.id, at) }
                    }
                }
                d.tagline?.let { Text(it, Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp), style = MaterialTheme.typography.titleMedium, fontStyle = FontStyle.Italic, color = Color.White.copy(alpha = 0.9f)) }
                d.overview?.let { Text(it, Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp), style = MaterialTheme.typography.bodyLarge, color = Color.White.copy(alpha = 0.85f)) }
                next?.let { n ->
                    Text("Next: ${n.subtitle()} ${n.title}", Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp).testTag("next"), color = MaterialTheme.colorScheme.primary)
                }
                val seasons = children.filter { it.kind.value == "season" }
                val episodes = children.filter { it.kind.value == "episode" }
                if (seasons.isNotEmpty()) TileSection("Seasons", seasons, client, openItem)
                if (episodes.isNotEmpty()) EpisodeSection(episodes, client, container.browsePrefs, openItem)
                d.files.forEach { f -> FileInfo(f) }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

/** What's in the file, one labelled line per kind of stream. */
@Composable
private fun FileInfo(f: MediaFile) {
    val video = f.streams.filter { it.type.value == "video" }.map { v ->
        listOfNotNull(v.codec.uppercase(), v.width?.let { w -> "$w×${v.height}" }, v.bitDepth?.let { "$it-bit" }, "HDR".takeIf { v.hdr }).joinToString(" · ")
    }
    val audio = f.streams.filter { it.type.value == "audio" }.map { a ->
        listOfNotNull(a.title ?: languageName(a.language), a.codec.uppercase(), a.channels?.let { channelLayout(it) }).joinToString(" · ")
    }
    val subs = (f.subtitles.map { it.title ?: languageName(it.language) } + f.streams.filter { it.type.value == "subtitle" && f.subtitles.none { s -> s.streamIndex == it.index } }.map { languageName(it.language) })
        .filterNotNull().distinct()
    Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 24.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surface).padding(16.dp).testTag("file-info"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(f.fileName, style = MaterialTheme.typography.bodyMedium, color = Color.White)
        InfoLine("File", listOfNotNull(f.container.uppercase(), formatMs(f.durationMs), formatSize(f.sizeBytes)).joinToString(" · "))
        video.forEach { InfoLine("Video", it) }
        audio.forEachIndexed { i, a -> InfoLine(if (i == 0) "Audio" else "", a) }
        if (subs.isNotEmpty()) InfoLine("Subtitles", subs.joinToString(", "))
    }
}

@Composable
private fun InfoLine(label: String, value: String) {
    Row {
        Text(label, Modifier.width(84.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.9f))
    }
}

private fun languageName(code: String?): String? = code?.takeIf { it.isNotBlank() && it != "und" }?.let { Locale.forLanguageTag(it).displayLanguage.ifBlank { it } }

private fun channelLayout(channels: Long): String = when (channels) {
    1L -> "Mono"
    2L -> "Stereo"
    6L -> "5.1"
    8L -> "7.1"
    else -> "$channels ch"
}

private fun formatRuntime(ms: Long): String {
    val minutes = ms / 60_000
    return if (minutes >= 60) "${minutes / 60}h ${minutes % 60}m" else "${minutes}m"
}

private fun formatSize(bytes: Long): String = if (bytes >= 1L shl 30) "%.1f GB".format(bytes / (1L shl 30).toDouble()) else "${bytes / (1L shl 20)} MB"

@Composable
private fun TileSection(title: String, list: List<ItemSummary>, client: app.projektor.core.ProjektorClient, openItem: (String) -> Unit) {
    Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 24.dp).testTag("children")) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Color.White)
        list.chunked(if (list.first().kind.value == "episode") 1 else 3).forEach { row ->
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                row.forEach { item -> PosterTile(item, client, onClick = { openItem(item.id) }, modifier = Modifier.weight(1f)) }
                repeat((if (row.first().kind.value == "episode") 1 else 3) - row.size) { Box(Modifier.weight(1f)) }
            }
        }
    }
}

/** Lists every file of an item with what tells them apart; tapping one plays it. */
@Composable
private fun VersionDialog(files: List<MediaFile>, onDismiss: () -> Unit, onPick: (MediaFile) -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Choose a version") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                files.forEach { f ->
                    Column(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Surface2).clickable { onPick(f) }.padding(12.dp).testTag("version-${f.id}"),
                    ) {
                        Text(f.fileName, style = MaterialTheme.typography.bodyMedium, color = Color.White, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        Text(describeVersion(f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
