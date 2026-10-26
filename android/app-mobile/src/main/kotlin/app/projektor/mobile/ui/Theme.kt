package app.projektor.mobile.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color

val Accent = Color(0xFFE8B14A)
val Bg = Color(0xFF0F1115)
val Surface = Color(0xFF181B22)
val Surface2 = Color(0xFF222630)
val Muted = Color(0xFF9AA1AD)

@Composable
fun ProjektorTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Accent,
            onPrimary = Bg,
            background = Bg,
            surface = Surface,
            surfaceVariant = Surface2,
            onSurfaceVariant = Muted,
        ),
    ) {
        // The app background, and light content on it: without a surface, text and icons default to black.
        Surface(Modifier.fillMaxSize(), color = Bg, content = content)
    }
}
