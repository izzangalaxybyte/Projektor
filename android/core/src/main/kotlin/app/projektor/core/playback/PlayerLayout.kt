package app.projektor.core.playback

import kotlin.math.max
import kotlin.math.roundToInt

/** Which edge (or the middle) of the screen a control keeps its distance from. */
enum class Anchor(val code: Char) { START('S'), CENTER('C'), END('E') }

/**
 * Where one control sits, free of any grid: a distance in dp from the nearest edge or from the
 * middle, on each axis. Anchoring to the nearest edge keeps a control placed by the right edge by
 * the right edge on a wider screen, and one placed in the middle in the middle.
 */
data class ControlPosition(val h: Anchor, val x: Float, val v: Anchor, val y: Float) {
    /** Left edge in px for a control [size] px wide on a screen [total] px wide. */
    fun left(total: Float, size: Float, density: Float): Float = place(h, x * density, total, size)
    fun top(total: Float, size: Float, density: Float): Float = place(v, y * density, total, size)

    fun encode(): String = "${h.code}:${fmt(x)}:${v.code}:${fmt(y)}"

    companion object {
        private fun place(a: Anchor, offset: Float, total: Float, size: Float): Float = when (a) {
            Anchor.START -> offset
            Anchor.CENTER -> total / 2 + offset - size / 2
            Anchor.END -> total - offset - size
        }.coerceIn(0f, max(0f, total - size))

        private fun anchorOf(center: Float, total: Float) = when {
            center < total / 3 -> Anchor.START
            center > total * 2 / 3 -> Anchor.END
            else -> Anchor.CENTER
        }

        private fun offsetOf(a: Anchor, start: Float, size: Float, total: Float, density: Float): Float = when (a) {
            Anchor.START -> start
            Anchor.CENTER -> start + size / 2 - total / 2
            Anchor.END -> total - start - size
        } / density

        /** The position of a control whose top-left is at ([left], [top]) px, anchored by which third its centre is in. */
        fun of(left: Float, top: Float, width: Float, height: Float, screenWidth: Float, screenHeight: Float, density: Float): ControlPosition {
            val h = anchorOf(left + width / 2, screenWidth)
            val v = anchorOf(top + height / 2, screenHeight)
            return ControlPosition(h, round(offsetOf(h, left, width, screenWidth, density)), v, round(offsetOf(v, top, height, screenHeight, density)))
        }

        fun decode(text: String): ControlPosition? {
            val p = text.split(":")
            if (p.size != 4) return null
            val h = Anchor.entries.firstOrNull { it.code.toString() == p[0] } ?: return null
            val v = Anchor.entries.firstOrNull { it.code.toString() == p[2] } ?: return null
            val x = p[1].toFloatOrNull()?.takeIf { it.isFinite() } ?: return null
            val y = p[3].toFloatOrNull()?.takeIf { it.isFinite() } ?: return null
            return ControlPosition(h, x, v, y)
        }

        private fun round(f: Float) = (f * 10).roundToInt() / 10f
        private fun fmt(f: Float) = if (f == f.toInt().toFloat()) f.toInt().toString() else f.toString()
    }
}

/** Everything that can be placed on the player screen. The customize button can't be removed, so the editor stays reachable. */
enum class PlayerControl(val label: String, val removable: Boolean = true) {
    BACK("Back"),
    TITLE("Title"),
    CUSTOMIZE("Customize", removable = false),
    PLAY_PAUSE("Play / pause"),
    REPLAY_30("Back 30s"),
    REPLAY_10("Back 10s"),
    REPLAY_5("Back 5s"),
    FORWARD_5("Forward 5s"),
    FORWARD_10("Forward 10s"),
    FORWARD_30("Forward 30s"),
    SKIP_90("+90s (anime)"),
    RESTART("Start over"),
    DOUBLE_TAP("Double-tap amount"),
    SPEED("Speed"),
    HOLD_SPEED("Hold speed"),
    AUDIO("Audio track"),
    SUBTITLES("Subtitles"),
    NEXT_EPISODE("Next episode"),
    FIT("Fit / fill screen"),
    LOCK("Lock screen"),
}

private fun pos(h: Anchor, x: Number, v: Anchor, y: Number) = ControlPosition(h, x.toFloat(), v, y.toFloat())

/**
 * Which controls show and where. The map's order is the drawing order: later ones sit on top
 * where two overlap.
 */
data class PlayerLayout(val placed: Map<PlayerControl, ControlPosition>) {
    val hidden: List<PlayerControl> get() = PlayerControl.entries.filter { it !in placed }

    /** Moves [control] to [position], or puts it on screen there; it keeps its drawing order. */
    fun place(control: PlayerControl, position: ControlPosition): PlayerLayout = PlayerLayout(placed + (control to position))

    /** Shows a hidden control where it goes by default. */
    fun add(control: PlayerControl): PlayerLayout = place(control, placed[control] ?: DEFAULT_POSITIONS.getValue(control))

    fun remove(control: PlayerControl): PlayerLayout = if (control.removable) PlayerLayout(placed - control) else this

    /** `NAME=S:8:S:8;NAME=C:0:C:-20` */
    fun encode(): String = placed.entries.joinToString(";") { (c, p) -> "${c.name}=${p.encode()}" }

    companion object {
        /** Defaults in dp, for every control including the ones hidden at first. */
        val DEFAULT_POSITIONS: Map<PlayerControl, ControlPosition> = mapOf(
            PlayerControl.BACK to pos(Anchor.START, 8, Anchor.START, 8),
            PlayerControl.TITLE to pos(Anchor.START, 60, Anchor.START, 10),
            PlayerControl.CUSTOMIZE to pos(Anchor.END, 8, Anchor.START, 8),
            PlayerControl.FIT to pos(Anchor.END, 60, Anchor.START, 8),
            // Middle row: play/pause (80dp) with 56dp skips 20dp apart either side.
            PlayerControl.PLAY_PAUSE to pos(Anchor.CENTER, 0, Anchor.CENTER, 0),
            PlayerControl.REPLAY_10 to pos(Anchor.CENTER, -88, Anchor.CENTER, 0),
            PlayerControl.FORWARD_10 to pos(Anchor.CENTER, 88, Anchor.CENTER, 0),
            PlayerControl.REPLAY_30 to pos(Anchor.CENTER, -164, Anchor.CENTER, 0),
            PlayerControl.FORWARD_30 to pos(Anchor.CENTER, 164, Anchor.CENTER, 0),
            PlayerControl.REPLAY_5 to pos(Anchor.CENTER, -240, Anchor.CENTER, 0),
            PlayerControl.FORWARD_5 to pos(Anchor.CENTER, 240, Anchor.CENTER, 0),
            PlayerControl.SKIP_90 to pos(Anchor.END, 24, Anchor.CENTER, 0),
            PlayerControl.LOCK to pos(Anchor.START, 24, Anchor.CENTER, 0),
            PlayerControl.RESTART to pos(Anchor.START, 24, Anchor.CENTER, -80),
            // The row just above the seek bar.
            PlayerControl.DOUBLE_TAP to pos(Anchor.START, 12, Anchor.END, 60),
            PlayerControl.SPEED to pos(Anchor.START, 140, Anchor.END, 60),
            PlayerControl.HOLD_SPEED to pos(Anchor.START, 224, Anchor.END, 60),
            PlayerControl.AUDIO to pos(Anchor.START, 326, Anchor.END, 60),
            PlayerControl.SUBTITLES to pos(Anchor.START, 476, Anchor.END, 60),
            PlayerControl.NEXT_EPISODE to pos(Anchor.END, 12, Anchor.END, 60),
        )

        private val DEFAULT_SHOWN = listOf(
            PlayerControl.BACK, PlayerControl.TITLE, PlayerControl.CUSTOMIZE,
            PlayerControl.REPLAY_30, PlayerControl.REPLAY_10, PlayerControl.PLAY_PAUSE, PlayerControl.FORWARD_10, PlayerControl.FORWARD_30,
            PlayerControl.SKIP_90,
            PlayerControl.DOUBLE_TAP, PlayerControl.SPEED, PlayerControl.HOLD_SPEED, PlayerControl.AUDIO, PlayerControl.SUBTITLES, PlayerControl.NEXT_EPISODE,
        )

        val DEFAULT = PlayerLayout(DEFAULT_SHOWN.associateWith { DEFAULT_POSITIONS.getValue(it) })

        /** Unknown or broken entries are dropped; the customize button is always put back. */
        fun decode(text: String?): PlayerLayout {
            if (text.isNullOrBlank()) return DEFAULT
            val placed = LinkedHashMap<PlayerControl, ControlPosition>()
            text.split(";").forEach { part ->
                val c = PlayerControl.entries.firstOrNull { it.name == part.substringBefore("=") } ?: return@forEach
                val p = ControlPosition.decode(part.substringAfter("=", "")) ?: return@forEach
                placed.putIfAbsent(c, p)
            }
            if (placed.isEmpty()) return DEFAULT
            PlayerControl.entries.filterNot { it.removable }.forEach { placed.putIfAbsent(it, DEFAULT_POSITIONS.getValue(it)) }
            return PlayerLayout(placed)
        }
    }
}
