package app.projektor.player

import android.text.SpannableStringBuilder
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.common.text.Cue
import androidx.media3.common.text.CueGroup

/**
 * WebVTT stacks cues that show at the same time exactly one line apart (line -1, -2, …), measured
 * by each cue's first line, so a two-line cue is drawn over the one above it. Merging the stacked
 * cues into one bottom cue, top cue first, lets the text lay itself out. Positioned cues are kept.
 */
fun stackCues(cues: List<Cue>): List<Cue> {
    val (stacked, placed) = cues.partition { it.text != null && it.lineType == Cue.LINE_TYPE_NUMBER && it.line < 0 }
    if (stacked.size < 2) return cues
    val ordered = stacked.sortedBy { it.line }
    val text = SpannableStringBuilder()
    ordered.forEachIndexed { i, cue ->
        if (i > 0) text.append('\n')
        text.append(cue.text)
    }
    return placed + ordered.last().buildUpon().setText(text).setLine(-1f, Cue.LINE_TYPE_NUMBER).build()
}

/** The player a PlayerView should show: [player] with its cues passed through [stackCues]. */
internal class StackedCuesPlayer(player: Player) : ForwardingPlayer(player) {
    private val wrapped = mutableMapOf<Player.Listener, Player.Listener>()

    override fun getCurrentCues(): CueGroup = super.getCurrentCues().stacked()

    override fun addListener(listener: Player.Listener) {
        val wrapper = object : Player.Listener by listener {
            override fun onCues(cueGroup: CueGroup) = listener.onCues(cueGroup.stacked())
            @Deprecated("Deprecated in Java")
            override fun onCues(cues: List<Cue>) = listener.onCues(stackCues(cues))
        }
        wrapped[listener] = wrapper
        super.addListener(wrapper)
    }

    override fun removeListener(listener: Player.Listener) {
        super.removeListener(wrapped.remove(listener) ?: listener)
    }

    private fun CueGroup.stacked() = CueGroup(stackCues(cues), presentationTimeUs)
}
