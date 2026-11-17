package app.projektor.mobile

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import androidx.activity.ComponentActivity
import androidx.annotation.OptIn
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.text.Cue
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.projektor.player.liftSubtitles
import app.projektor.player.showWithStackedSubtitles
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

/** Zooming 16:9 video to fill a 20:9 screen leaves the subtitles where fit mode draws them. */
@OptIn(UnstableApi::class)
@RunWith(AndroidJUnit4::class)
class SubtitlePlacementTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun zoomKeepsTheFitModeGapUnderSubtitles() {
        var fill by mutableStateOf(false)
        lateinit var view: PlayerView
        rule.setContent {
            val d = LocalDensity.current
            AndroidView(
                factory = { ctx ->
                    PlayerView(ctx).apply {
                        useController = false
                        findViewById<AspectRatioFrameLayout>(androidx.media3.ui.R.id.exo_content_frame).setAspectRatio(16f / 9f)
                        subtitleView!!.setCues(listOf(Cue.Builder().setText("Subtitle line").build()))
                        view = this
                    }
                },
                update = {
                    it.resizeMode = if (fill) AspectRatioFrameLayout.RESIZE_MODE_ZOOM else AspectRatioFrameLayout.RESIZE_MODE_FIT
                    it.liftSubtitles(0)
                },
                modifier = with(d) { Modifier.size(1000.toDp(), 450.toDp()) },
            )
        }
        rule.waitForIdle()
        val fit = gapUnderText(view)
        fill = true
        rule.waitForIdle()
        Thread.sleep(300)
        rule.waitForIdle()
        val zoom = gapUnderText(view)
        assertTrue("gap under subtitles: fit $fit px, zoom $zoom px", fit > 0 && abs(fit - zoom) <= 4)
    }

    /**
     * The same with the real player: a video playing with a sideloaded WebVTT cue. Needs the sample
     * movie pushed first: adb push "fixtures/movies/Sample Movie (2019)/Sample Movie (2019).mp4" /data/local/tmp/sample.mp4
     */
    @Test
    fun zoomKeepsTheGapWhilePlaying() {
        org.junit.Assume.assumeTrue(java.io.File("/data/local/tmp/sample.mp4").canRead())
        val ctx = rule.activity
        val vtt = java.io.File(ctx.cacheDir, "t.vtt").apply { writeText("WEBVTT\n\n00:00.000 --> 01:00.000\nSubtitle line\n") }
        val projektor = rule.runOnUiThread { app.projektor.player.ProjektorPlayer(ctx) }
        var fill by mutableStateOf(false)
        lateinit var view: PlayerView
        rule.setContent {
            val d = LocalDensity.current
            AndroidView(
                factory = { c -> PlayerView(c).apply { useController = false; showWithStackedSubtitles(projektor); view = this } },
                update = {
                    it.resizeMode = if (fill) AspectRatioFrameLayout.RESIZE_MODE_ZOOM else AspectRatioFrameLayout.RESIZE_MODE_FIT
                    it.liftSubtitles(0)
                },
                modifier = with(d) { Modifier.size(1000.toDp(), 450.toDp()) },
            )
        }
        rule.runOnUiThread {
            val item = androidx.media3.common.MediaItem.Builder()
                .setUri(android.net.Uri.fromFile(java.io.File("/data/local/tmp/sample.mp4")))
                .setSubtitleConfigurations(listOf(
                    androidx.media3.common.MediaItem.SubtitleConfiguration.Builder(android.net.Uri.fromFile(vtt))
                        .setMimeType(androidx.media3.common.MimeTypes.TEXT_VTT).setLanguage("en")
                        .setSelectionFlags(androidx.media3.common.C.SELECTION_FLAG_DEFAULT).build(),
                ))
                .build()
            projektor.exo.setMediaItem(item)
            projektor.exo.prepare()
            projektor.exo.playWhenReady = true
        }
        rule.waitUntil(15_000) { gapUnderText(view) > 0 }
        Thread.sleep(500)
        val fit = gapUnderText(view)
        fill = true
        rule.waitForIdle()
        Thread.sleep(500)
        rule.waitForIdle()
        val zoom = gapUnderText(view)
        rule.runOnUiThread { projektor.exo.release() }
        // WebVTT puts the cue on line -1; it must still get the usual bottom padding (8% of 450 px).
        assertTrue("playing: gap under subtitles: fit $fit px, zoom $zoom px", fit >= 30 && abs(fit - zoom) <= 4)
    }

    /** Pixels between the lowest white (subtitle text) pixel and the bottom of [view]. */
    private fun gapUnderText(view: PlayerView): Int {
        var gap = -1
        rule.runOnUiThread {
            val bmp = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
            view.draw(Canvas(bmp))
            for (y in bmp.height - 1 downTo 0) {
                if ((0 until bmp.width).any { x -> bmp.getPixel(x, y).let { Color.red(it) > 200 && Color.green(it) > 200 && Color.blue(it) > 200 } }) {
                    gap = bmp.height - 1 - y
                    break
                }
            }
        }
        return gap
    }
}
