package app.projektor.mobile

import android.app.Application
import app.projektor.core.ProjektorClient
import app.projektor.core.auth.AuthRepository
import app.projektor.core.auth.PrefsSessionStore
import app.projektor.core.auth.SessionStore
import app.projektor.core.items.ItemsRepository
import app.projektor.core.playback.PlayerPrefs
import app.projektor.core.playback.SharedPrefsPlayerPrefs

/** Hand-rolled dependency container; small enough not to need a framework. */
class AppContainer(app: Application) {
    val sessions: SessionStore = PrefsSessionStore(app)
    val playerPrefs: PlayerPrefs = SharedPrefsPlayerPrefs(app)
    val auth = AuthRepository(sessions, deviceName = "Android phone")

    /** Client for the signed-in server; null while signed out. */
    fun client(): ProjektorClient? = sessions.serverUrl.value?.takeIf { sessions.session.value != null }?.let { auth.client(it) }
    fun items(): ItemsRepository? = client()?.let { ItemsRepository(it) }
}

class ProjektorApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
