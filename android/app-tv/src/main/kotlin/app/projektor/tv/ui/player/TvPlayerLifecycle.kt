package app.projektor.tv.ui.player

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import app.projektor.player.ProjektorPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

// Outlives the screen: the composition's own scope is already cancelled by the time onDispose runs.
private val releaseScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

/**
 * Keeps the screen on while [player] shows, pauses it when the app is backgrounded, and stops it
 * as soon as the screen leaves; [onClose] runs after the player is released.
 */
@Composable
fun TvPlayerLifecycle(player: ProjektorPlayer, onClose: suspend () -> Unit = {}) {
    val view = LocalView.current
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { player.pause() }
    DisposableEffect(Unit) {
        view.keepScreenOn = true
        onDispose {
            player.pause()
            view.keepScreenOn = false
            releaseScope.launch { player.release(); onClose() }
        }
    }
}
