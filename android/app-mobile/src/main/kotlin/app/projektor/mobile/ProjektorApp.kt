package app.projektor.mobile

import android.app.Application
import app.projektor.core.ProjektorClient
import app.projektor.core.auth.AuthRepository
import app.projektor.core.auth.PrefsSessionStore
import app.projektor.core.auth.SessionStore
import app.projektor.core.comics.ComicsRepository
import app.projektor.core.items.ItemsRepository
import app.projektor.core.live.LiveRepository
import app.projektor.core.playback.PlayerPrefs
import app.projektor.core.playback.SharedPrefsPlayerPrefs
import app.projektor.mobile.comics.ComicDownloadStore
import app.projektor.mobile.comics.ComicProgressStore
import app.projektor.mobile.comics.ReaderPrefs
import app.projektor.mobile.comics.comicImageLoader
import app.projektor.mobile.download.DownloadStore
import app.projektor.mobile.ui.item.BrowsePrefs
import kotlinx.coroutines.flow.MutableStateFlow

/** Hand-rolled dependency container; small enough not to need a framework. */
class AppContainer(app: Application) {
    val sessions: SessionStore = PrefsSessionStore(app)
    val playerPrefs: PlayerPrefs = SharedPrefsPlayerPrefs(app)
    val browsePrefs = BrowsePrefs(app)
    val downloads = DownloadStore(app) { client() }
    val comicDownloads = ComicDownloadStore(app) { comics() }
    val comicProgress = ComicProgressStore(app)
    val readerPrefs = ReaderPrefs(app)
    /** The comic reader's image loader: pages from the server, a downloaded CBZ, or a PDF. */
    val comicImages by lazy { comicImageLoader(app) }
    /** Set when a download notification is tapped; the UI goes to the Downloads tab and clears it. */
    val openDownloads = MutableStateFlow(false)
    val auth = AuthRepository(sessions, deviceName = "Android phone")

    /** Client for the signed-in server; null while signed out. */
    fun client(): ProjektorClient? = sessions.serverUrl.value?.takeIf { sessions.session.value != null }?.let { auth.client(it) }
    fun items(): ItemsRepository? = client()?.let { ItemsRepository(it) }
    fun live(): LiveRepository? = client()?.let { LiveRepository(it) }
    fun comics(): ComicsRepository? = client()?.let { ComicsRepository(it) }

    // Last, once everything the downloads need is set up.
    init {
        downloads.resume()
        comicDownloads.resume()
    }
}

class ProjektorApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
