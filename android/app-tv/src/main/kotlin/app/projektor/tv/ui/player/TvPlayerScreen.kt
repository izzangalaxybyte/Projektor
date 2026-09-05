package app.projektor.tv.ui.player

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.tv.material3.Button
import androidx.tv.material3.Text
import app.projektor.tv.TvContainer

/** Replaced by the remote-driven player in 2.8. */
@Composable
fun TvPlayerScreen(container: TvContainer, fileId: String, itemId: String, startMs: Long, playNext: (String, String) -> Unit, back: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Button(onClick = back) { Text("Player for $fileId arrives in 2.8 · back") }
    }
}
