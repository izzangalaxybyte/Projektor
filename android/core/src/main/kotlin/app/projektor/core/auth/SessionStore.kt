package app.projektor.core.auth

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Where the app is signed in: server address, bearer token, and the profile behind it. */
data class Session(val serverUrl: String, val token: String, val profileId: String, val profileName: String, val isAdmin: Boolean)

/** Persists the session across launches. Backed by SharedPreferences; observable for Compose. */
interface SessionStore {
    val session: StateFlow<Session?>
    val serverUrl: StateFlow<String?>
    fun setServerUrl(url: String)
    fun signIn(session: Session)
    fun signOut()
}

class PrefsSessionStore(context: Context) : SessionStore {
    private val prefs = context.getSharedPreferences("projektor.session", Context.MODE_PRIVATE)
    private val _session = MutableStateFlow(load())
    private val _serverUrl = MutableStateFlow(prefs.getString(KEY_SERVER, null))
    override val session: StateFlow<Session?> = _session
    override val serverUrl: StateFlow<String?> = _serverUrl

    override fun setServerUrl(url: String) {
        val trimmed = url.trim().trimEnd('/')
        prefs.edit().putString(KEY_SERVER, trimmed).apply()
        _serverUrl.value = trimmed
    }

    override fun signIn(session: Session) {
        prefs.edit()
            .putString(KEY_SERVER, session.serverUrl)
            .putString(KEY_TOKEN, session.token)
            .putString(KEY_PROFILE_ID, session.profileId)
            .putString(KEY_PROFILE_NAME, session.profileName)
            .putBoolean(KEY_ADMIN, session.isAdmin)
            .apply()
        _serverUrl.value = session.serverUrl
        _session.value = session
    }

    override fun signOut() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_PROFILE_ID).remove(KEY_PROFILE_NAME).remove(KEY_ADMIN).apply()
        _session.value = null
    }

    private fun load(): Session? {
        val server = prefs.getString(KEY_SERVER, null) ?: return null
        val token = prefs.getString(KEY_TOKEN, null) ?: return null
        return Session(server, token, prefs.getString(KEY_PROFILE_ID, "") ?: "", prefs.getString(KEY_PROFILE_NAME, "") ?: "", prefs.getBoolean(KEY_ADMIN, false))
    }

    private companion object {
        const val KEY_SERVER = "server"
        const val KEY_TOKEN = "token"
        const val KEY_PROFILE_ID = "profileId"
        const val KEY_PROFILE_NAME = "profileName"
        const val KEY_ADMIN = "isAdmin"
    }
}

/** In-memory store for tests and previews. */
class MemorySessionStore(initial: Session? = null, server: String? = initial?.serverUrl) : SessionStore {
    private val _session = MutableStateFlow(initial)
    private val _serverUrl = MutableStateFlow(server)
    override val session: StateFlow<Session?> = _session
    override val serverUrl: StateFlow<String?> = _serverUrl
    override fun setServerUrl(url: String) { _serverUrl.value = url.trim().trimEnd('/') }
    override fun signIn(session: Session) { _serverUrl.value = session.serverUrl; _session.value = session }
    override fun signOut() { _session.value = null }
}
