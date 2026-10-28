package app.projektor.mobile.ui.comics

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.projektor.mobile.comics.ColorMode
import app.projektor.mobile.comics.FitMode
import app.projektor.mobile.comics.PageMode
import app.projektor.mobile.comics.ReadMode
import app.projektor.mobile.comics.ReaderBackground
import app.projektor.mobile.comics.ReaderSettings
import app.projektor.mobile.comics.ScreenOrientation

/** Every reader setting, remembered for the series (and as the default for new ones). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun SettingsPanel(s: ReaderSettings, bookIsManga: Boolean, update: (ReaderSettings) -> Unit, onClose: () -> Unit) {
    // A tap outside the panel closes it; the panel itself swallows taps.
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)).clickable(onClick = onClose)) {
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .widthIn(max = 640.dp)
                .fillMaxWidth()
                .fillMaxHeight(0.75f)
                .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp))
                .background(MaterialTheme.colorScheme.surface)
                .pointerInput(Unit) { detectTapGestures { } }
                .windowInsetsPadding(WindowInsets.navigationBars)
                .testTag("comic-settings-panel"),
        ) {
            Row(Modifier.padding(start = 20.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Reader", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                TextButton(onClick = { update(ReaderSettings(readMode = s.readMode)) }) { Text("Reset") }
                IconButton(onClick = onClose) { Icon(Icons.Filled.Close, "Close") }
            }
            Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Section("Reading direction") {
                    Choice("From the book (${if (bookIsManga) "right to left" else "left to right"})", s.readMode == null) { update(s.copy(readMode = null)) }
                    ReadMode.entries.forEach { m -> Choice(m.label, s.readMode == m) { update(s.copy(readMode = m)) } }
                }
                Section("Pages") {
                    PageMode.entries.forEach { m -> Choice(m.label, s.pageMode == m) { update(s.copy(pageMode = m)) } }
                }
                Toggle("Cover on its own", "Two-page mode: so printed spreads face each other", s.coverAlone) { update(s.copy(coverAlone = it)) }
                Toggle("Shift spreads by one page", "For books whose double pages come out split", s.shiftSpreads) { update(s.copy(shiftSpreads = it)) }
                Section("Fit") {
                    FitMode.entries.forEach { f -> Choice(f.label, s.fit == f) { update(s.copy(fit = f)) } }
                }
                Section("Background") {
                    ReaderBackground.entries.forEach { b -> Choice(b.label, s.background == b) { update(s.copy(background = b)) } }
                }
                Level("Brightness", s.brightness, 0.2f..1f) { update(s.copy(brightness = it)) }
                Level("Contrast", s.contrast, 0.5f..1.5f) { update(s.copy(contrast = it)) }
                Level("Colour saturation", s.saturation, 0f..1.5f) { update(s.copy(saturation = it)) }
                Section("Colour") {
                    ColorMode.entries.forEach { c -> Choice(c.label, s.color == c) { update(s.copy(color = c)) } }
                }
                Section("Screen rotation") {
                    ScreenOrientation.entries.forEach { o -> Choice(o.label, s.orientation == o) { update(s.copy(orientation = o)) } }
                }
                Toggle("Tap the sides to turn pages", "The middle shows the controls", s.tapZones) { update(s.copy(tapZones = it)) }
                Toggle("Volume keys turn pages", null, s.volumeKeys) { update(s.copy(volumeKeys = it)) }
                Toggle("Animate page turns", null, s.animatePageTurns) { update(s.copy(animatePageTurns = it)) }
                Toggle("Page strip under the controls", null, s.showThumbnailStrip) { update(s.copy(showThumbnailStrip = it)) }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { content() }
    }
}

@Composable
private fun Choice(label: String, selected: Boolean, onClick: () -> Unit) {
    FilterChip(selected = selected, onClick = onClick, label = { Text(label) })
}

@Composable
private fun Toggle(title: String, detail: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!checked) }, verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun Level(title: String, value: Float, range: ClosedFloatingPointRange<Float>, onChange: (Float) -> Unit) {
    Column {
        Row {
            Text(title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
            Text("${(value * 100).toInt()}%", style = MaterialTheme.typography.labelLarge)
        }
        Slider(value = value, onValueChange = onChange, valueRange = range)
    }
}
