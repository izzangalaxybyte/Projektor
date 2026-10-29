package app.projektor.mobile.comics

import android.content.Context
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** How pages are laid out: turned left to right, right to left (manga), or scrolled (webtoon). */
enum class ReadMode(val label: String) { LTR("Left to right"), RTL("Right to left (manga)"), WEBTOON("Vertical scroll (webtoon)") }

enum class PageMode(val label: String) { SINGLE("Single page"), DOUBLE("Two pages"), AUTO("Two pages in landscape") }

enum class FitMode(val label: String) { SCREEN("Fit screen"), WIDTH("Fit width"), HEIGHT("Fit height"), ORIGINAL("Original size") }

enum class ReaderBackground(val label: String, val argb: Long) { BLACK("Black", 0xFF000000), GRAY("Gray", 0xFF303030), WHITE("White", 0xFFFFFFFF) }

enum class ColorMode(val label: String) { NORMAL("Normal"), GRAYSCALE("Grayscale"), SEPIA("Sepia"), INVERT("Inverted (night)") }

enum class ScreenOrientation(val label: String) { AUTO("Rotate freely"), PORTRAIT("Portrait"), LANDSCAPE("Landscape") }

/** Everything CDisplayEx lets you set, remembered per series. */
@Serializable
data class ReaderSettings(
    /** Null follows the book: right to left when it is tagged as manga. */
    val readMode: ReadMode? = null,
    val pageMode: PageMode = PageMode.AUTO,
    /** Two-page mode: the cover stands alone so printed spreads face each other. */
    val coverAlone: Boolean = true,
    /** Two-page mode: pair pages one later, for books whose spreads come out misaligned. */
    val shiftSpreads: Boolean = false,
    val fit: FitMode = FitMode.SCREEN,
    val background: ReaderBackground = ReaderBackground.BLACK,
    /** 0.2..1: dims the page below the phone's own brightness. */
    val brightness: Float = 1f,
    val contrast: Float = 1f,
    val saturation: Float = 1f,
    val color: ColorMode = ColorMode.NORMAL,
    val tapZones: Boolean = true,
    val volumeKeys: Boolean = true,
    val animatePageTurns: Boolean = true,
    val orientation: ScreenOrientation = ScreenOrientation.AUTO,
    val showThumbnailStrip: Boolean = true,
) {
    /** Two pages side by side right now. */
    fun double(landscape: Boolean): Boolean = pageMode == PageMode.DOUBLE || (pageMode == PageMode.AUTO && landscape)

    /** Brightness, contrast, saturation and colour mode as one colour matrix; null when untouched. */
    fun colorFilter(): ColorFilter? {
        if (contrast == 1f && saturation == 1f && color == ColorMode.NORMAL) return null
        val m = ColorMatrix()
        if (saturation != 1f) m.timesAssign(ColorMatrix().apply { setToSaturation(saturation) })
        if (contrast != 1f) {
            val t = (1f - contrast) * 128f
            m.timesAssign(ColorMatrix(floatArrayOf(contrast, 0f, 0f, 0f, t, 0f, contrast, 0f, 0f, t, 0f, 0f, contrast, 0f, t, 0f, 0f, 0f, 1f, 0f)))
        }
        when (color) {
            ColorMode.NORMAL -> Unit
            ColorMode.GRAYSCALE -> m.timesAssign(ColorMatrix().apply { setToSaturation(0f) })
            ColorMode.SEPIA -> m.timesAssign(
                ColorMatrix(floatArrayOf(0.393f, 0.769f, 0.189f, 0f, 0f, 0.349f, 0.686f, 0.168f, 0f, 0f, 0.272f, 0.534f, 0.131f, 0f, 0f, 0f, 0f, 0f, 1f, 0f)),
            )
            ColorMode.INVERT -> m.timesAssign(ColorMatrix(floatArrayOf(-1f, 0f, 0f, 0f, 255f, 0f, -1f, 0f, 0f, 255f, 0f, 0f, -1f, 0f, 255f, 0f, 0f, 0f, 1f, 0f)))
        }
        return ColorFilter.colorMatrix(m)
    }
}

/**
 * Reader settings per series. A change is also kept as the default for series not opened yet,
 * except the reading direction, which belongs to the series (manga and comics differ).
 */
class ReaderPrefs(context: Context) {
    private val prefs = context.getSharedPreferences("projektor.reader", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    fun get(seriesId: String): ReaderSettings =
        read("series.$seriesId") ?: read(KEY_DEFAULT) ?: ReaderSettings()

    fun set(seriesId: String, settings: ReaderSettings) {
        prefs.edit()
            .putString("series.$seriesId", json.encodeToString(ReaderSettings.serializer(), settings))
            .putString(KEY_DEFAULT, json.encodeToString(ReaderSettings.serializer(), settings.copy(readMode = null)))
            .apply()
    }

    private fun read(key: String): ReaderSettings? =
        prefs.getString(key, null)?.let { runCatching { json.decodeFromString(ReaderSettings.serializer(), it) }.getOrNull() }

    private companion object {
        const val KEY_DEFAULT = "default"
    }
}
