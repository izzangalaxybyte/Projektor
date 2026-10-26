package app.projektor.mobile.ui.player

import android.app.Activity
import android.content.pm.ActivityInfo
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import app.projektor.core.playback.formatRate
import app.projektor.player.ProjektorPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

// Outlives the screen: the composition's own scope is already cancelled by the time onDispose runs.
private val releaseScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

/**
 * Fullscreen player window: landscape, immersive, screen kept on. Playback pauses when the app is
 * backgrounded and stops as soon as the screen leaves; [onClose] runs after the player is released.
 */
@Composable
fun PlayerWindow(player: ProjektorPlayer, onClose: suspend () -> Unit = {}) {
    val context = LocalContext.current
    val view = LocalView.current
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { player.pause() }
    DisposableEffect(Unit) {
        val activity = context as? Activity
        val window = activity?.window
        val previousOrientation = activity?.requestedOrientation
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        val controller = window?.let { WindowInsetsControllerCompat(it, view) }
        controller?.hide(WindowInsetsCompat.Type.systemBars())
        controller?.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        window?.let { WindowCompat.setDecorFitsSystemWindows(it, false) }
        view.keepScreenOn = true
        onDispose {
            player.pause()
            view.keepScreenOn = false
            controller?.show(WindowInsetsCompat.Type.systemBars())
            if (previousOrientation != null) activity.requestedOrientation = previousOrientation
            releaseScope.launch { player.release(); onClose() }
        }
    }
}

/** White content over the video, whatever the surrounding theme provides. */
@Composable
fun PlayerChrome(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalContentColor provides Color.White, content = content)
}

val TopScrim = Modifier.background(Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.85f), 0.6f to Color.Black.copy(alpha = 0.6f), 1f to Color.Transparent))
val BottomScrim = Modifier.background(Brush.verticalGradient(0f to Color.Transparent, 0.3f to Color.Black.copy(alpha = 0.65f), 1f to Color.Black.copy(alpha = 0.9f)))
val ButtonScrim = Modifier.background(Color.Black.copy(alpha = 0.45f), CircleShape)

/** Shown while the screen is held down and playback runs at [rate]. */
@Composable
fun SpeedBoostBadge(rate: Float, modifier: Modifier = Modifier) {
    Row(
        modifier.background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(50)).padding(horizontal = 14.dp, vertical = 6.dp).testTag("speed-boost"),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(formatRate(rate), style = MaterialTheme.typography.labelLarge, color = Color.White)
        Icon(Icons.Filled.FastForward, null, Modifier.size(18.dp), tint = Color.White)
    }
}
