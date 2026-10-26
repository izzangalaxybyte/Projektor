package app.projektor.core.playback

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * The player settings that matter most here: how far a skip jumps, the playback speed (same
 * options as the web player), and the speed while the screen is held down. Persisted per device.
 */
data class PlayerSettings(val skipSeconds: Int = DEFAULT_SKIP_SECONDS, val rate: Float = 1f, val holdRate: Float = DEFAULT_HOLD_RATE) {
    val skipMs: Long get() = skipSeconds * 1000L
}

const val DEFAULT_SKIP_SECONDS = 10
val SKIP_OPTIONS: List<Int> = listOf(3, 4, 5, 6, 7, 8, 9, 10, 15)
val RATE_OPTIONS: List<Float> = listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)
const val DEFAULT_HOLD_RATE = 2f
val HOLD_RATE_OPTIONS: List<Float> = listOf(1.5f, 2f, 2.5f, 3f)

fun formatRate(rate: Float): String = if (rate == 1f) "Normal" else "${rate.toString().trimEnd('0').trimEnd('.')}×"

/** Validates stored values so an old or corrupt preference can never produce an odd jump. */
fun sanitizeSettings(skipSeconds: Int?, rate: Float?, holdRate: Float? = null): PlayerSettings = PlayerSettings(
    skipSeconds = skipSeconds?.takeIf { it in SKIP_OPTIONS } ?: DEFAULT_SKIP_SECONDS,
    rate = rate?.takeIf { it in RATE_OPTIONS } ?: 1f,
    holdRate = holdRate?.takeIf { it in HOLD_RATE_OPTIONS } ?: DEFAULT_HOLD_RATE,
)

interface PlayerPrefs {
    val settings: StateFlow<PlayerSettings>
    fun update(skipSeconds: Int? = null, rate: Float? = null, holdRate: Float? = null)
}

class SharedPrefsPlayerPrefs(context: Context) : PlayerPrefs {
    private val prefs = context.getSharedPreferences("projektor.player", Context.MODE_PRIVATE)
    private val _settings = MutableStateFlow(
        sanitizeSettings(
            prefs.getInt(KEY_SKIP, DEFAULT_SKIP_SECONDS),
            prefs.getFloat(KEY_RATE, 1f),
            prefs.getFloat(KEY_HOLD_RATE, DEFAULT_HOLD_RATE),
        ),
    )
    override val settings: StateFlow<PlayerSettings> = _settings

    override fun update(skipSeconds: Int?, rate: Float?, holdRate: Float?) {
        val current = _settings.value
        val next = sanitizeSettings(skipSeconds ?: current.skipSeconds, rate ?: current.rate, holdRate ?: current.holdRate)
        prefs.edit().putInt(KEY_SKIP, next.skipSeconds).putFloat(KEY_RATE, next.rate).putFloat(KEY_HOLD_RATE, next.holdRate).apply()
        _settings.value = next
    }

    private companion object {
        const val KEY_SKIP = "skipSeconds"
        const val KEY_RATE = "rate"
        const val KEY_HOLD_RATE = "holdRate"
    }
}

class MemoryPlayerPrefs(initial: PlayerSettings = PlayerSettings()) : PlayerPrefs {
    private val _settings = MutableStateFlow(initial)
    override val settings: StateFlow<PlayerSettings> = _settings
    override fun update(skipSeconds: Int?, rate: Float?, holdRate: Float?) {
        val current = _settings.value
        _settings.value = sanitizeSettings(skipSeconds ?: current.skipSeconds, rate ?: current.rate, holdRate ?: current.holdRate)
    }
}
