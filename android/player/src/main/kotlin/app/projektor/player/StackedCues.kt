package app.projektor.player

import android.text.SpannableStringBuilder
import android.view.View
import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.text.Cue
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.PlayerView
import androidx.media3.ui.SubtitleView
import io.github.peerless2012.ass.media.kt.withAssSupport
import io.github.peerless2012.ass.media.widget.AssSubtitleView

/**
 * WebVTT stacks cues that show at the same time exactly one line apart (line -1, -2, …), measured
 * by each cue's first line, so a two-line cue is drawn over the one above it. Merging the stacked
 * cues into one bottom cue, top cue first, lets the text lay itself out. Positioned cues are kept.
 */
@OptIn(UnstableApi::class)
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
@OptIn(UnstableApi::class)
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

/**
 * Keeps subtitles above the bottom [controlsPx] pixels of this view, where the player's controls
 * are, or puts them back with 0. Cues get a larger bottom padding; the ASS layer, whose script
 * places its own lines, slides up as a whole. Only the part of the controls that overlaps the
 * picture counts, so letterboxed video with room below it does not move.
 *
 * The subtitle view lives inside the video frame, so when the video is zoomed to fill the screen
 * its edges are cropped off with the picture. It is then scaled down around the screen's centre to
 * fit the screen, which puts every line, top or bottom, where fit mode would. This is worked out
 * again whenever the subtitle view is laid out (a resize-mode switch, rotation), since that happens
 * after the call that asked for it.
 */
@OptIn(UnstableApi::class)
fun PlayerView.liftSubtitles(controlsPx: Int) {
    val subs = subtitleView ?: return
    if (subs.getTag(R.id.projektor_lift_px) == null) {
        subs.addOnLayoutChangeListener { _, _, top, _, bottom, _, oldTop, _, oldBottom ->
            if (top != oldTop || bottom != oldBottom) {
                post { applyLift(subs.getTag(R.id.projektor_lift_px) as? Int ?: 0) }
            }
        }
    }
    subs.setTag(R.id.projektor_lift_px, controlsPx)
    applyLift(controlsPx)
}

@OptIn(UnstableApi::class)
private fun PlayerView.applyLift(controlsPx: Int) {
    val subs = subtitleView ?: return
    if (subs.height == 0) return
    // Where the subtitle view sits in this view, before scaling: it fills the video frame, which is
    // a child of this view.
    val frame = (subs.parent as? View)?.takeIf { it.parent === this }
    val subsLeft = (frame?.left ?: 0) + subs.left
    val subsTop = (frame?.top ?: 0) + subs.top
    // Zoomed video is bigger than the screen; shrink the subtitles to the visible part, as they
    // would be laid out in fit mode, so lines at the top and the bottom are not cropped.
    val scale = minOf(1f, width.toFloat() / subs.width, height.toFloat() / subs.height)
    val pivotY = height / 2f - subsTop
    subs.pivotX = width / 2f - subsLeft
    subs.pivotY = pivotY
    subs.scaleX = scale
    subs.scaleY = scale
    val shownBottom = subsTop + pivotY + (subs.height - pivotY) * scale
    val gapBelow = height - shownBottom
    // In the subtitle view's own (unscaled) pixels.
    val overlap = ((controlsPx - gapBelow).coerceAtLeast(0f) / scale).toInt()
    subs.setBottomPaddingFraction(SubtitleView.DEFAULT_BOTTOM_PADDING_FRACTION + overlap.toFloat() / subs.height)
    for (i in 0 until subs.childCount) {
        val child = subs.getChildAt(i)
        if (child is AssSubtitleView && child.translationY != -overlap.toFloat()) {
            child.animate().translationY(-overlap.toFloat()).setDuration(150).start()
        }
    }
}

