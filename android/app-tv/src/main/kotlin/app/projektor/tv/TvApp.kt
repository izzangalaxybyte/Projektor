package app.projektor.tv

import android.app.Application
import app.projektor.core.ProjektorClient
import app.projektor.core.auth.AuthRepository
import app.projektor.core.auth.PrefsSessionStore
import app.projektor.core.auth.SessionStore
import app.projektor.core.items.ItemsRepository
import app.projektor.core.live.LiveRepository
import app.projektor.core.playback.PlayerPrefs
import app.projektor.core.playback.SharedPrefsPlayerPrefs

class TvContainer(app: Application) {
    val sessions: SessionStore = PrefsSessionStore(app)
    val playerPrefs: PlayerPrefs = SharedPrefsPlayerPrefs(app)
    val auth = AuthRepository(sessions, deviceName = "Android TV")
    fun client(): ProjektorClient? = sessions.serverUrl.value?.takeIf { sessions.session.value != null }?.let { auth.client(it) }
    fun items(): ItemsRepository? = client()?.let { ItemsRepository(it) }
    fun live(): LiveRepository? = client()?.let { LiveRepository(it) }
}

class TvApp : Application() {
    lateinit var container: TvContainer
        private set
    override fun onCreate() {
        super.onCreate()
        container = TvContainer(this)
    }
}
