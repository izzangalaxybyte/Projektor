package app.projektor.core.playback

/**
 * Where the phone player's controls sit. The screen has seven zones: both ends of the top bar,
 * the middle row, a column down either edge, and both ends of the row under the seek bar. Each
 * zone holds its controls in order; a control not in any zone is hidden.
 */
enum class PlayerZone(val label: String, val vertical: Boolean = false) {
    TOP_START("Top left"),
    TOP_END("Top right"),
    LEFT("Left edge", vertical = true),
    CENTER("Middle"),
    RIGHT("Right edge", vertical = true),
    BOTTOM_START("Bottom left"),
    BOTTOM_END("Bottom right"),
}

/** Everything that can be placed on the player screen. [defaultZone] is where an added one goes. */
enum class PlayerControl(val label: String, val defaultZone: PlayerZone) {
    BACK("Back", PlayerZone.TOP_START),
    PLAY_PAUSE("Play / pause", PlayerZone.CENTER),
    REPLAY_30("Back 30s", PlayerZone.CENTER),
    REPLAY_10("Back 10s", PlayerZone.CENTER),
    REPLAY_5("Back 5s", PlayerZone.CENTER),
    FORWARD_5("Forward 5s", PlayerZone.CENTER),
    FORWARD_10("Forward 10s", PlayerZone.CENTER),
    FORWARD_30("Forward 30s", PlayerZone.CENTER),
    SKIP_90("+90s (anime)", PlayerZone.RIGHT),
    RESTART("Start over", PlayerZone.LEFT),
    DOUBLE_TAP("Double-tap amount", PlayerZone.BOTTOM_START),
    SPEED("Speed", PlayerZone.BOTTOM_START),
    HOLD_SPEED("Hold speed", PlayerZone.BOTTOM_START),
    AUDIO("Audio track", PlayerZone.BOTTOM_START),
    SUBTITLES("Subtitles", PlayerZone.BOTTOM_START),
    NEXT_EPISODE("Next episode", PlayerZone.BOTTOM_END),
    FIT("Fit / fill screen", PlayerZone.TOP_END),
    LOCK("Lock screen", PlayerZone.LEFT),
}

data class PlayerLayout(val zones: Map<PlayerZone, List<PlayerControl>>) {
    fun controls(zone: PlayerZone): List<PlayerControl> = zones[zone].orEmpty()
    val placed: Set<PlayerControl> get() = zones.values.flatten().toSet()
    val hidden: List<PlayerControl> get() = PlayerControl.entries.filter { it !in placed }
    fun zoneOf(control: PlayerControl): PlayerZone? = PlayerZone.entries.firstOrNull { control in controls(it) }

    /** Takes [control] out of wherever it is and puts it at [index] of [zone] (clamped). */
    fun move(control: PlayerControl, zone: PlayerZone, index: Int = Int.MAX_VALUE): PlayerLayout {
        val without = remove(control)
        val target = without.controls(zone).toMutableList()
        target.add(index.coerceIn(0, target.size), control)
        return PlayerLayout(without.zones + (zone to target))
    }

    fun add(control: PlayerControl): PlayerLayout = move(control, control.defaultZone)

    fun remove(control: PlayerControl): PlayerLayout = PlayerLayout(zones.mapValues { (_, list) -> list - control })

    /** `ZONE=A,B;ZONE=C`. Every zone is written, so an empty one stays empty when read back. */
    fun encode(): String = PlayerZone.entries.joinToString(";") { z -> "${z.name}=${controls(z).joinToString(",") { it.name }}" }

    companion object {
        val DEFAULT = PlayerLayout(
            mapOf(
                PlayerZone.TOP_START to listOf(PlayerControl.BACK),
                PlayerZone.CENTER to listOf(PlayerControl.REPLAY_30, PlayerControl.REPLAY_10, PlayerControl.PLAY_PAUSE, PlayerControl.FORWARD_10, PlayerControl.FORWARD_30),
                PlayerZone.RIGHT to listOf(PlayerControl.SKIP_90),
                PlayerZone.BOTTOM_START to listOf(PlayerControl.DOUBLE_TAP, PlayerControl.SPEED, PlayerControl.HOLD_SPEED, PlayerControl.AUDIO, PlayerControl.SUBTITLES),
                PlayerZone.BOTTOM_END to listOf(PlayerControl.NEXT_EPISODE),
            ),
        )

        /** Unknown zones and controls are dropped, and a control listed twice keeps its first place. */
        fun decode(text: String?): PlayerLayout {
            if (text.isNullOrBlank()) return DEFAULT
            val seen = mutableSetOf<PlayerControl>()
            val zones = text.split(";").mapNotNull { part ->
                val zone = PlayerZone.entries.firstOrNull { it.name == part.substringBefore("=") } ?: return@mapNotNull null
                zone to part.substringAfter("=", "").split(",").mapNotNull { n -> PlayerControl.entries.firstOrNull { it.name == n }?.takeIf(seen::add) }
            }.toMap()
            return if (zones.isEmpty()) DEFAULT else PlayerLayout(zones)
        }
    }
}
