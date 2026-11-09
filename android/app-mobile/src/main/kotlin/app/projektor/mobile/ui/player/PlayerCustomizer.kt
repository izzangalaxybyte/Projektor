package app.projektor.mobile.ui.player

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitTouchSlopOrCancellation
import androidx.compose.foundation.gestures.drag
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
import androidx.compose.ui.input.pointer.positionChange
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
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.material.icons.filled.DashboardCustomize
import androidx.compose.material.icons.filled.Title
import androidx.compose.material.icons.filled.VerticalAlignBottom
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.material3.IconButton
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.layout.onSizeChanged
import app.projektor.core.playback.ControlPosition
import kotlin.math.abs
import kotlin.math.roundToInt

/** The icon a control shows in the Add panel. */
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
        PlayerControl.TITLE -> Icons.Filled.Title
        PlayerControl.CUSTOMIZE -> Icons.Filled.DashboardCustomize
    }

/**
 * Lays the player's controls out freely, over the video: drag any button anywhere (it snaps to
 * the screen's middle lines), tap × to hide it, and bring hidden ones back from Add (tap, or hold
 * and drag one into place). [render] draws each control as it will look. Nothing is saved until
 * Save; Back or Cancel leaves the layout as it was.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PlayerCustomizer(initial: PlayerLayout, render: @Composable (PlayerControl) -> Unit, onSave: (PlayerLayout) -> Unit, onClose: () -> Unit) {
    val density = LocalDensity.current.density
    val snapPx = 8 * density
    var layout by remember { mutableStateOf(initial) }
    var trayOpen by remember { mutableStateOf(false) }
    var toolbarLow by remember { mutableStateOf(false) }
    var origin by remember { mutableStateOf(Offset.Zero) }
    var canvas by remember { mutableStateOf(IntSize.Zero) }
    val sizes = remember { mutableStateMapOf<PlayerControl, IntSize>() }
    var dragging by remember { mutableStateOf<PlayerControl?>(null) }
    var snapX by remember { mutableStateOf(false) }
    var snapY by remember { mutableStateOf(false) }
    // Dragging a hidden one out of the Add panel: a copy follows the finger (root px).
    var adding by remember { mutableStateOf<PlayerControl?>(null) }
    var ghost by remember { mutableStateOf(Offset.Zero) }
    val trayChips = remember { mutableStateMapOf<PlayerControl, Rect>() }
    var trayBounds by remember { mutableStateOf(Rect.Zero) }
    // A control just dragged out of the panel, centred on the drop point once its real size is known.
    var recenter by remember { mutableStateOf<Pair<PlayerControl, Offset>?>(null) }

    BackHandler { if (trayOpen) trayOpen = false else onClose() }

    /** Where [c]'s top-left is now, in px. */
    fun topLeftOf(c: PlayerControl): Offset? {
        val size = sizes[c] ?: return null
        val pos = layout.placed[c] ?: return null
        return Offset(pos.left(canvas.width.toFloat(), size.width.toFloat(), density), pos.top(canvas.height.toFloat(), size.height.toFloat(), density))
    }

    /** Puts [c]'s top-left at [want] px, kept on screen and snapped to the middle lines. */
    fun moveTo(c: PlayerControl, want: Offset) {
        val size = sizes[c] ?: return
        val w = canvas.width.toFloat(); val h = canvas.height.toFloat()
        val cw = size.width.toFloat(); val ch = size.height.toFloat()
        var left = want.x.coerceIn(0f, maxOf(0f, w - cw))
        var top = want.y.coerceIn(0f, maxOf(0f, h - ch))
        snapX = abs(left + cw / 2 - w / 2) < snapPx
        snapY = abs(top + ch / 2 - h / 2) < snapPx
        if (snapX) left = w / 2 - cw / 2
        if (snapY) top = h / 2 - ch / 2
        layout = layout.place(c, ControlPosition.of(left, top, cw, ch, w, h, density))
    }

    fun endMove() { dragging = null; snapX = false; snapY = false }

    fun dropNew() {
        val c = adding ?: return
        adding = null
        if (trayBounds.contains(ghost)) return
        val chip = trayChips[c]
        val cw = chip?.width ?: 0f; val ch = chip?.height ?: 0f
        val local = ghost - origin
        val w = canvas.width.toFloat(); val h = canvas.height.toFloat()
        val left = (local.x - cw / 2).coerceIn(0f, maxOf(0f, w - cw))
        val top = (local.y - ch / 2).coerceIn(0f, maxOf(0f, h - ch))
        layout = layout.place(c, ControlPosition.of(left, top, cw, ch, w, h, density))
        recenter = c to local
    }

    PlayerChrome {
        Box(
            Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f))
                .onGloballyPositioned { origin = it.positionInRoot(); canvas = it.size }
                // Swallows taps so they don't reach the player underneath.
                .pointerInput(Unit) { detectTapGestures { } }
                .testTag("player-customizer"),
        ) {
            PlayerBackdrop(seekBar = {
                Box(Modifier.fillMaxWidth().padding(horizontal = 48.dp, vertical = 20.dp).height(4.dp).background(Color.White.copy(alpha = 0.4f), RoundedCornerShape(2.dp)))
            })

            // Toolbar; it stays under the buttons and out of the way while one is moved.
            if (dragging == null && adding == null) Column(
                Modifier.align(if (toolbarLow) Alignment.BottomCenter else Alignment.TopCenter).padding(top = 64.dp, bottom = 120.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Row(
                    Modifier.background(Color.Black.copy(alpha = 0.75f), RoundedCornerShape(50)).padding(horizontal = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(onClick = { trayOpen = !trayOpen }, modifier = Modifier.testTag("customize-add")) {
                        Icon(Icons.Filled.Add, null, Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("Add", color = Color.White)
                    }
                    TextButton(onClick = { layout = PlayerLayout.DEFAULT }, modifier = Modifier.testTag("customize-reset")) { Text("Reset", color = Color.White) }
                    TextButton(onClick = onClose, modifier = Modifier.testTag("customize-cancel")) { Text("Cancel", color = Color.White) }
                    Button(onClick = { onSave(layout) }, modifier = Modifier.testTag("customize-save")) { Text("Save") }
                    IconButton(onClick = { toolbarLow = !toolbarLow }, modifier = Modifier.size(40.dp).testTag("customize-toolbar-move")) {
                        Icon(if (toolbarLow) Icons.Filled.VerticalAlignTop else Icons.Filled.VerticalAlignBottom, "Move this toolbar")
                    }
                }
                Text("Drag any button anywhere · × hides it", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.7f))
            }

            // Guides when a button snaps to the middle.
            if (snapX) Box(Modifier.align(Alignment.Center).fillMaxHeight().width(1.dp).background(MaterialTheme.colorScheme.primary))
            if (snapY) Box(Modifier.align(Alignment.Center).fillMaxWidth().height(1.dp).background(MaterialTheme.colorScheme.primary))

            FreeControls(layout, Modifier.fillMaxSize()) { c ->
                val active = dragging == c
                Box(
                    Modifier.onSizeChanged { size ->
                        sizes[c] = size
                        recenter?.takeIf { it.first == c }?.let { (_, at) -> recenter = null; moveTo(c, at - Offset(size.width / 2f, size.height / 2f)) }
                    },
                ) {
                    render(c)
                    // Covers the real control so a touch moves it instead of pressing it.
                    Box(
                        Modifier.matchParentSize()
                            .background(if (active) Color.White.copy(alpha = 0.2f) else Color.Transparent, RoundedCornerShape(10.dp))
                            .border(if (active) 2.dp else 1.dp, if (active) MaterialTheme.colorScheme.primary else Color.White.copy(alpha = 0.45f), RoundedCornerShape(10.dp))
                            .pointerInput(c) {
                                // Follows the finger from where it first touched, slop included. The
                                // wanted spot is tracked unclamped so a snap or an edge never sticks.
                                awaitEachGesture {
                                    val down = awaitFirstDown()
                                    val start = awaitTouchSlopOrCancellation(down.id) { ch, _ -> ch.consume() } ?: return@awaitEachGesture
                                    var want = (topLeftOf(c) ?: return@awaitEachGesture) + (start.position - down.position)
                                    dragging = c
                                    try {
                                        moveTo(c, want)
                                        drag(start.id) { ch -> want += ch.positionChange(); ch.consume(); moveTo(c, want) }
                                    } finally { endMove() }
                                }
                            }
                            .testTag("custom-${c.name.lowercase()}"),
                    )
                    if (c.removable && !active) Box(
                        Modifier.align(Alignment.TopEnd).offset(x = 4.dp, y = (-4).dp).size(20.dp)
                            .background(MaterialTheme.colorScheme.error, CircleShape)
                            .clickable { layout = layout.remove(c) }
                            .testTag("remove-${c.name.lowercase()}"),
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Filled.Close, "Hide ${c.label}", Modifier.size(14.dp), tint = Color.White) }
                }
            }

            // The hidden controls. It fades while one is dragged out so the screen shows through.
            if (trayOpen) Column(
                Modifier.align(Alignment.Center).widthIn(max = 480.dp).heightIn(max = 250.dp)
                    .onGloballyPositioned { trayBounds = it.boundsInRoot() }
                    .alpha(if (adding != null) 0.15f else 1f)
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
                Text("Tap to add, or hold and drag one to where you want it.", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.6f))
                val hidden = layout.hidden
                if (hidden.isEmpty()) Text("Every button is already on screen.", style = MaterialTheme.typography.bodySmall)
                FlowRow(Modifier.verticalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    hidden.forEach { c ->
                        key(c) {
                            TrayChip(
                                c,
                                Modifier.onGloballyPositioned { trayChips[c] = it.boundsInRoot() }
                                    .pointerInput(c) {
                                        detectDragGesturesAfterLongPress(
                                            onDragStart = { at -> adding = c; ghost = (trayChips[c]?.topLeft ?: Offset.Zero) + at },
                                            onDrag = { ch, d -> ch.consume(); ghost += d },
                                            onDragEnd = ::dropNew,
                                            onDragCancel = { adding = null },
                                        )
                                    }
                                    .clickable { layout = layout.add(c) }
                                    .testTag("add-${c.name.lowercase()}"),
                            )
                        }
                    }
                }
            }

            adding?.let { c ->
                val size = trayChips[c]
                Box(
                    Modifier.offset { IntOffset((ghost.x - origin.x - (size?.width ?: 0f) / 2).roundToInt(), (ghost.y - origin.y - (size?.height ?: 0f) / 2).roundToInt()) }
                        .alpha(0.9f),
                ) { TrayChip(c) }
            }
        }
    }
}

/**
 * Places each control of [controls] at its own position over the whole area, the same way in the
 * player and in the editor. [onBottomInset] gets how far up from the bottom the controls in the
 * lower part of the screen reach, so subtitles can move above them.
 */
@Composable
fun FreeControls(controls: PlayerLayout, modifier: Modifier = Modifier, onBottomInset: (Int) -> Unit = {}, control: @Composable (PlayerControl) -> Unit) {
    val density = LocalDensity.current.density
    Layout(
        content = { controls.placed.keys.forEach { c -> key(c) { Box(Modifier.layoutId(c)) { control(c) } } } },
        modifier = modifier,
    ) { measurables, constraints ->
        val w = constraints.maxWidth
        val h = constraints.maxHeight
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val placeables = measurables.map { (it.layoutId as PlayerControl) to it.measure(loose) }
        layout(w, h) {
            var highest = h
            placeables.forEach { (c, p) ->
                val pos = controls.placed[c] ?: return@forEach
                val x = pos.left(w.toFloat(), p.width.toFloat(), density).roundToInt()
                val y = pos.top(h.toFloat(), p.height.toFloat(), density).roundToInt()
                if (p.height > 0 && y + p.height / 2 > h * 0.55f) highest = minOf(highest, y)
                p.place(x, y)
            }
            onBottomInset(h - highest)
        }
    }
}

/** The fixed parts behind the controls: the top and bottom shading, and the seek bar along the bottom. */
@Composable
fun BoxScope.PlayerBackdrop(seekBar: @Composable () -> Unit, onSeekBarHeight: (Int) -> Unit = {}) {
    Box(Modifier.align(Alignment.TopStart).fillMaxWidth().height(96.dp).then(TopScrim))
    Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(150.dp).then(BottomScrim))
    Box(Modifier.align(Alignment.BottomStart).fillMaxWidth().onSizeChanged { onSeekBarHeight(it.height) }) { seekBar() }
}

/** A hidden control as the Add panel shows it: its icon and name. */
@Composable
private fun TrayChip(c: PlayerControl, modifier: Modifier = Modifier) {
    Row(
        modifier.background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(50)).border(1.dp, Color.White.copy(alpha = 0.5f), RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (c == PlayerControl.SKIP_90) Text("+90", style = MaterialTheme.typography.labelMedium) else Icon(c.icon, null, Modifier.size(16.dp))
        Text(c.label, style = MaterialTheme.typography.labelMedium)
    }
}
