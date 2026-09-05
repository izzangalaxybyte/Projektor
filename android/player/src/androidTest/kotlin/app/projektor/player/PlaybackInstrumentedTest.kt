package app.projektor.player

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.projektor.core.api.models.ItemSummary
import app.projektor.core.api.models.LibraryKindInput
import app.projektor.core.items.ItemsRepository
import app.projektor.core.api.models.PlaybackDecideRequestInput
import app.projektor.core.api.models.PlaybackMethod
import app.projektor.core.auth.AuthRepository
import app.projektor.core.auth.MemorySessionStore
import app.projektor.core.playback.DeviceProfiles
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Needs the API running on the host with the fixtures scanned (see docs/android.md). Plays the
 * h264/aac movie directly for a few seconds and checks that progress reached the server, then
 * asks for a decision on the hevc/ac3 episode, which an emulator without those decoders must
 * get back as a transcode.
 */
@RunWith(AndroidJUnit4::class)
class PlaybackInstrumentedTest {
    private val serverUrl = InstrumentationRegistry.getArguments().getString("serverUrl") ?: "http://10.0.2.2:8096"

    @Test
    fun playsDirectlyReportsProgressAndGetsTranscodeForUnsupportedCodecs() = runBlocking {
        val store = MemorySessionStore()
        val repo = AuthRepository(store, deviceName = "instrumented")
        if (repo.needsSetup(serverUrl)) repo.setup(serverUrl, "Izzan", "1234") else repo.login(serverUrl, repo.profiles(serverUrl).first().id, "1234")
        val client = repo.client()
        val items = ItemsRepository(client)

        val movies = items.list(libraryKind = LibraryKindInput.MOVIE, search = "Sample Movie").items
        assertTrue("Sample Movie must be scanned on the server", movies.isNotEmpty())
        val movie = items.detail(movies.first().id)
        val file = movie.files.first()
        val profile = DeviceProfiles.current("Emulator")
        val decision = items.decide(PlaybackDecideRequestInput(fileId = file.id, profile = profile))
        assertEquals(PlaybackMethod.DIRECT, decision.method)

        var reported = 0
        val player = withContext(Dispatchers.Main) {
            ProjektorPlayer(ApplicationProvider.getApplicationContext(), onProgress = { pos, dur ->
                items.reportProgress(movie.id, pos, dur)
                reported++
            }, progressIntervalMs = 3_000)
        }
        withContext(Dispatchers.Main) { player.load(mediaSpecFor(decision, client), startMs = 0, knownDurationMs = file.durationMs.toLong()) }
        delay(7_000)
        val position = withContext(Dispatchers.Main) { player.exo.currentPosition }
        withContext(Dispatchers.Main) { player.release() }
        assertTrue("position should advance, was $position", position > 2_000)
        assertTrue("progress should have been reported", reported >= 1)
        val progress = items.detail(movie.id).progress
        assertTrue("server should hold progress", (progress?.positionMs ?: 0) > 1_000)

        // The hevc/ac3 episode: emulators decode neither, so the server must transcode.
        val shows = items.list(libraryKind = LibraryKindInput.TV).items
        assertTrue(shows.isNotEmpty())
        val episode = firstEpisode(items, shows.first())
        val epDecision = items.decide(PlaybackDecideRequestInput(fileId = episode.files.first().id, profile = profile))
        if ("hevc" !in profile.videoCodecs || "ac3" !in profile.audioCodecs) {
            assertTrue("expected remux or transcode, got ${epDecision.method}: ${epDecision.reason}", epDecision.method != PlaybackMethod.DIRECT)
        }
    }

    private suspend fun firstEpisode(items: ItemsRepository, show: ItemSummary) = run {
        val season = items.detail(show.id).children.first()
        val ep = items.children(season.id).first()
        items.detail(ep.id)
    }
}
