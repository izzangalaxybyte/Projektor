package app.projektor.core

import app.projektor.core.api.apis.AuthApi
import app.projektor.core.api.apis.ItemsApi
import app.projektor.core.api.apis.LibrariesApi
import app.projektor.core.api.apis.PlaybackApi
import app.projektor.core.api.apis.ProgressApi
import app.projektor.core.api.apis.SettingsApi
import app.projektor.core.api.apis.SystemApi
import app.projektor.core.api.apis.UsersApi
import io.ktor.client.HttpClientConfig
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.header
import io.ktor.http.HttpHeaders
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

/** API version this client was built against (packages/api-contract/openapi.json). */
const val API_VERSION = "1.0.0"

/**
 * One entry point to the generated API. Every request carries the bearer token supplied by
 * [tokenProvider], read per request so it can change after login or logout.
 */
class ProjektorClient(
    val baseUrl: String,
    private val tokenProvider: () -> String?,
    engine: HttpClientEngine? = null,
) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; isLenient = true }
    // The generated ApiClient installs ContentNegotiation without a serializer; add ours, a timeout,
    // and the bearer header. Ktor merges repeated install() blocks for the same plugin.
    private val configure: (HttpClientConfig<*>) -> Unit = { config ->
        config.install(ContentNegotiation) { json(json) }
        config.install(HttpTimeout) { requestTimeoutMillis = 30_000; connectTimeoutMillis = 10_000 }
        config.defaultRequest {
            tokenProvider()?.let { header(HttpHeaders.Authorization, "Bearer $it") }
        }
    }
    private val base = baseUrl.trimEnd('/')
    private val httpEngine: HttpClientEngine by lazy { engine ?: OkHttp.create() }

    val system by lazy { SystemApi(base, httpEngine, configure) }
    val auth by lazy { AuthApi(base, httpEngine, configure) }
    val users by lazy { UsersApi(base, httpEngine, configure) }
    val libraries by lazy { LibrariesApi(base, httpEngine, configure) }
    val items by lazy { ItemsApi(base, httpEngine, configure) }
    val playback by lazy { PlaybackApi(base, httpEngine, configure) }
    val progress by lazy { ProgressApi(base, httpEngine, configure) }
    val settings by lazy { SettingsApi(base, httpEngine, configure) }

    /** URL for cached artwork at a given width. */
    fun imageUrl(key: String?, width: Int): String? = key?.let { "$base/api/images/$it?w=$width" }

    /** Appends the token for URLs a player fetches itself (streams, playlists, subtitles). */
    fun withAccessToken(path: String): String {
        val token = tokenProvider() ?: return "$base$path"
        val sep = if (path.contains('?')) '&' else '?'
        return "$base$path${sep}access_token=$token"
    }
}
