package app.projektor.mobile.ui.player

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AspectRatio
import androidx.compose.material.icons.filled.AudioFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material.icons.filled.Forward30
import androidx.compose.material.icons.filled.Forward5
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material.icons.filled.Replay30
import androidx.compose.material.icons.filled.Replay5
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Subtitles
import androidx.compose.material.icons.filled.TouchApp
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import app.projektor.core.playback.PlayerControl
import app.projektor.core.playback.PlayerLayout
import app.projektor.core.playback.PlayerZone
import kotlin.math.roundToInt

/** The icon a control shows; null for the ones that are a labelled picker or button. */
val PlayerControl.icon: ImageVector
    get() = when (this) {
        PlayerControl.BACK -> Icons.AutoMirrored.Filled.ArrowBack
        PlayerControl.PLAY_PAUSE -> Icons.Filled.PlayArrow
        PlayerControl.REPLAY_30 -> Icons.Filled.Replay30
        PlayerControl.REPLAY_10 -> Icons.Filled.Replay10
        PlayerControl.REPLAY_5 -> Icons.Filled.Replay5
        PlayerControl.FORWARD_5 -> Icons.Filled.Forward5
        PlayerControl.FORWARD_10 -> Icons.Filled.Forward10
        PlayerControl.FORWARD_30 -> Icons.Filled.Forward30
        PlayerControl.SKIP_90 -> Icons.Filled.FastForward
        PlayerControl.RESTART -> Icons.Filled.RestartAlt
        PlayerControl.DOUBLE_TAP -> Icons.Filled.TouchApp
        PlayerControl.SPEED, PlayerControl.HOLD_SPEED -> Icons.Filled.Speed
        PlayerControl.AUDIO -> Icons.Filled.AudioFile
        PlayerControl.SUBTITLES -> Icons.Filled.Subtitles
        PlayerControl.NEXT_EPISODE -> Icons.Filled.SkipNext
        PlayerControl.FIT -> Icons.Filled.AspectRatio
        PlayerControl.LOCK -> Icons.Filled.Lock
    }

/** Pickers and the next-episode button show as a labelled pill; the rest as a round icon. */
val PlayerControl.isPill: Boolean
    get() = this in setOf(PlayerControl.DOUBLE_TAP, PlayerControl.SPEED, PlayerControl.HOLD_SPEED, PlayerControl.AUDIO, PlayerControl.SUBTITLES, PlayerControl.NEXT_EPISODE)

/**
 * Lays out the player's controls: drag one to another spot or zone, tap × to take it off, and
 * add hidden ones from the Add panel (tap, or hold and drag into place). Nothing is saved until
 * Save; Back or Cancel leaves the layout as it was.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PlayerCustomizer(initial: PlayerLayout, onSave: (PlayerLayout) -> Unit, onClose: () -> Unit) {
    var layout by remember { mutableStateOf(initial) }
    var trayOpen by remember { mutableStateOf(false) }
    var dragging by remember { mutableStateOf<PlayerControl?>(null) }
    var dragFromTray by remember { mutableStateOf(false) }
    var dragSize by remember { mutableStateOf(IntSize.Zero) }
    // Pointer and bounds are all in root coordinates.
    var pointer by remember { mutableStateOf(Offset.Zero) }
    var origin by remember { mutableStateOf(Offset.Zero) }
    val zoneBounds = remember { mutableStateMapOf<PlayerZone, Rect>() }
    val chipBounds = remember { mutableStateMapOf<PlayerControl, Rect>() }
    var trayBounds by remember { mutableStateOf(Rect.Zero) }
    var trashBounds by remember { mutableStateOf(Rect.Zero) }
    val reach = with(LocalDensity.current) { 40.dp.toPx() }

    BackHandler { if (trayOpen) trayOpen = false else onClose() }

    /** The zone under the pointer, or the nearest one within reach of it. */
    fun zoneAt(p: Offset): PlayerZone? = zoneBounds.entries
        .map { (z, r) -> z to maxOf(r.left - p.x, 0f, p.x - r.right) + maxOf(r.top - p.y, 0f, p.y - r.bottom) }
        .filter { it.second <= reach }
        .minByOrNull { it.second }?.first

    fun drop() {
        val c = dragging ?: return
        dragging = null
        val p = pointer
        if (!dragFromTray && (trashBounds.contains(p) || (trayOpen && trayBounds.contains(p)))) { layout = layout.remove(c); return }
        val zone = zoneAt(p) ?: return
        val others = layout.controls(zone) - c
        val index = others.count { o -> chipBounds[o]?.let { b -> if (zone.vertical) b.center.y < p.y else b.center.x < p.x } ?: false }
        layout = layout.move(c, zone, index)
    }

    fun startDrag(c: PlayerControl, at: Offset, fromTray: Boolean) {
        val b = chipBounds[c] ?: return
        dragging = c; dragFromTray = fromTray
        dragSize = IntSize(b.width.roundToInt(), b.height.roundToInt())
        pointer = b.topLeft + at
    }

    val target = dragging?.let { zoneAt(pointer) }

    @Composable
    fun Chip(c: PlayerControl, inTray: Boolean) {
        val handle = Modifier
            .onGloballyPositioned { chipBounds[c] = it.boundsInRoot() }
            .pointerInput(c, inTray) {
                val onStart = { at: Offset -> startDrag(c, at, inTray) }
                if (inTray) detectDragGesturesAfterLongPress(
                    onDragStart = onStart,
                    onDrag = { ch, d -> ch.consume(); pointer += d },
                    onDragEnd = ::drop,
                    onDragCancel = { dragging = null },
                ) else detectDragGestures(
                    onDragStart = onStart,
                    onDrag = { ch, d -> ch.consume(); pointer += d },
                    onDragEnd = ::drop,
                    onDragCancel = { dragging = null },
                )
            }
            .alpha(if (dragging == c) 0.3f else 1f)
            .testTag("custom-${c.name.lowercase()}")
        Box(handle) {
            ChipFace(c, Modifier.then(if (inTray) Modifier.clickable { layout = layout.add(c) } else Modifier))
            if (!inTray) {
                Box(
                    Modifier.align(Alignment.TopEnd).offset(x = 6.dp, y = (-6).dp).size(20.dp)
                        .background(MaterialTheme.colorScheme.error, CircleShape)
                        .clickable { layout = layout.remove(c) }
                        .testTag("remove-${c.name.lowercase()}"),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.Close, "Remove ${c.label}", Modifier.size(14.dp), tint = Color.White) }
            }
        }
    }

    @Composable
    fun Zone(zone: PlayerZone, modifier: Modifier = Modifier) {
        val highlight = target == zone
        val shape = RoundedCornerShape(12.dp)
        val frame = modifier
            .onGloballyPositioned { zoneBounds[zone] = it.boundsInRoot() }
            .sizeIn(minWidth = 64.dp, minHeight = 56.dp)
            .background(if (highlight) Color.White.copy(alpha = 0.18f) else Color.White.copy(alpha = 0.05f), shape)
            .border(if (highlight) 2.dp else 1.dp, if (highlight) MaterialTheme.colorScheme.primary else Color.White.copy(alpha = 0.3f), shape)
            .padding(10.dp)
            .testTag("zone-${zone.name.lowercase()}")
        val items = layout.controls(zone)
        val content: @Composable () -> Unit = {
            if (items.isEmpty()) Text(zone.label, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.5f))
            items.forEach { c -> key(c) { Chip(c, inTray = false) } }
        }
        if (zone.vertical) Column(frame, verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally) { content() }
        else Row(frame, horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) { content() }
    }

    PlayerChrome {
        Box(
            Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.88f))
                .onGloballyPositioned { origin = it.positionInRoot() }
                // Swallows taps so they don't reach the player underneath.
                .pointerInput(Unit) { detectTapGestures { } }
                .testTag("player-customizer"),
        ) {
            Zone(PlayerZone.TOP_START, Modifier.align(Alignment.TopStart).padding(12.dp))
            Zone(PlayerZone.TOP_END, Modifier.align(Alignment.TopEnd).padding(12.dp))
            Zone(PlayerZone.LEFT, Modifier.align(Alignment.CenterStart).padding(start = 12.dp))
            Zone(PlayerZone.CENTER, Modifier.align(Alignment.Center))
            Zone(PlayerZone.RIGHT, Modifier.align(Alignment.CenterEnd).padding(end = 12.dp))
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                // Stands in for the seek bar, which always stays put.
                Box(Modifier.fillMaxWidth().padding(horizontal = 40.dp).height(4.dp).background(Color.White.copy(alpha = 0.35f), RoundedCornerShape(2.dp)))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Zone(PlayerZone.BOTTOM_START, Modifier.weight(1f))
                    Zone(PlayerZone.BOTTOM_END)
                }
            }

            // Toolbar; while a placed control is dragged it becomes the bin.
            Box(Modifier.align(Alignment.TopCenter).padding(top = 12.dp)) {
                if (dragging != null && !dragFromTray) {
                    val over = trashBounds.contains(pointer)
                    Row(
                        Modifier.onGloballyPositioned { trashBounds = it.boundsInRoot() }
                            .background(if (over) MaterialTheme.colorScheme.error else Color.Black.copy(alpha = 0.7f), RoundedCornerShape(50))
                            .border(1.dp, MaterialTheme.colorScheme.error, RoundedCornerShape(50))
                            .padding(horizontal = 20.dp, vertical = 12.dp)
                            .testTag("customize-bin"),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(Icons.Filled.Delete, null)
                        Text("Drop here to remove", style = MaterialTheme.typography.labelLarge)
                    }
                } else Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedButton(onClick = { trayOpen = !trayOpen }, modifier = Modifier.testTag("customize-add")) {
                            Icon(Icons.Filled.Add, null, Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("Add")
                        }
                        TextButton(onClick = { layout = PlayerLayout.DEFAULT }, modifier = Modifier.testTag("customize-reset")) { Text("Reset", color = Color.White) }
                        TextButton(onClick = onClose, modifier = Modifier.testTag("customize-cancel")) { Text("Cancel", color = Color.White) }
                        Button(onClick = { onSave(layout) }, modifier = Modifier.testTag("customize-save")) { Text("Save") }
                    }
                    Text("Drag buttons to move them · × removes", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.6f))
                }
            }

            // The hidden controls. It fades while one of its own is dragged so the zones show through.
            if (trayOpen) {
                Column(
                    Modifier.align(Alignment.Center).widthIn(max = 460.dp).heightIn(max = 240.dp)
                        .onGloballyPositioned { trayBounds = it.boundsInRoot() }
                        .alpha(if (dragging != null && dragFromTray) 0.15f else 1f)
                        .background(Color(0xFF1E1E1E), RoundedCornerShape(16.dp))
                        .border(1.dp, Color.White.copy(alpha = 0.2f), RoundedCornerShape(16.dp))
                        .padding(16.dp)
                        .testTag("customize-tray"),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Add buttons", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                        Icon(Icons.Filled.Close, "Close", Modifier.size(20.dp).clickable { trayOpen = false })
                    }
                    Text("Tap to add, or hold and drag into place. Drag a button here to remove it.", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.6f))
                    val hidden = layout.hidden
                    if (hidden.isEmpty()) Text("Every button is already on screen.", style = MaterialTheme.typography.bodySmall)
                    FlowRow(Modifier.verticalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        hidden.forEach { c -> key(c) { Column(horizontalAlignment = Alignment.CenterHorizontally) { Chip(c, inTray = true); if (!c.isPill) Text(c.label, style = MaterialTheme.typography.labelSmall) } } }
                    }
                }
            }

            // What's being dragged follows the finger.
            dragging?.let { c ->
                Box(
                    Modifier.offset { IntOffset((pointer.x - origin.x - dragSize.width / 2f).roundToInt(), (pointer.y - origin.y - dragSize.height / 2f).roundToInt()) }
                        .alpha(0.9f),
                ) { ChipFace(c) }
            }
        }
    }
}

/** How a control looks in the editor: a round icon, or a labelled pill for pickers. */
@Composable
private fun ChipFace(c: PlayerControl, modifier: Modifier = Modifier) {
    if (c.isPill) {
        Row(
            modifier.background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(50)).border(1.dp, Color.White.copy(alpha = 0.5f), RoundedCornerShape(50)).padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(c.icon, null, Modifier.size(16.dp))
            Text(c.label, style = MaterialTheme.typography.labelMedium)
        }
    } else {
        val big = c == PlayerControl.PLAY_PAUSE
        Box(modifier.size(if (big) 56.dp else 44.dp).then(ButtonScrim).border(1.dp, Color.White.copy(alpha = 0.4f), CircleShape), contentAlignment = Alignment.Center) {
            if (c == PlayerControl.SKIP_90) Text("+90", style = MaterialTheme.typography.labelLarge)
            else Icon(c.icon, c.label, Modifier.size(if (big) 36.dp else 26.dp))
        }
    }
}
