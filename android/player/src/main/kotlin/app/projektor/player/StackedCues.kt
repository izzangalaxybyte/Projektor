package app.projektor.player

import android.text.SpannableStringBuilder
import androidx.media3.common.Player
import androidx.media3.common.text.Cue
import androidx.media3.common.text.CueGroup
import androidx.media3.ui.PlayerView
import io.github.peerless2012.ass.media.kt.withAssSupport

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

/**
 * Shows [player] in this PlayerView with simultaneous subtitle cues stacked by [stackCues], and
 * ASS subtitles drawn by libass in a layer over the cues.
 *
 * PlayerView feeds its subtitle view from its own listener; this one is added after it, so for each
 * cue update ours runs last and its stacked cues are what stays on screen. (An earlier version
 * wrapped the player in a ForwardingPlayer whose listener used Kotlin `by` delegation. Kotlin does
 * not delegate Java default methods, so every event but onCues was dropped, including
 * onRenderedFirstFrame, and PlayerView never lifted its black shutter: all video was black.)
 */
fun PlayerView.showWithStackedSubtitles(projektor: ProjektorPlayer) {
    val player: Player = projektor.exo
    this.player = player
    subtitleView?.withAssSupport(projektor.assHandler)
    player.addListener(
        object : Player.Listener {
            override fun onCues(cueGroup: CueGroup) {
                subtitleView?.setCues(stackCues(cueGroup.cues))
            }
        },
    )
}
