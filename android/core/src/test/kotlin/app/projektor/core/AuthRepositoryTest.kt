package app.projektor.core

import app.projektor.core.auth.AuthRepository
import app.projektor.core.auth.MemorySessionStore
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Drives the generated client against a fake server that speaks the frozen contract. */
class AuthRepositoryTest {
    private val json = headersOf(HttpHeaders.ContentType, "application/json")
    private val seen = mutableListOf<Pair<String, String?>>()

    private val engine = MockEngine { request ->
        seen += request.url.encodedPath to request.headers[HttpHeaders.Authorization]
        when (request.url.encodedPath) {
            "/api/auth/setup" -> respond("""{"needsSetup":false}""", HttpStatusCode.OK, json)
            "/api/auth/profiles" -> respond("""[{"id":"u1","name":"Izzan","isAdmin":true,"avatarColor":"#e57373"}]""", HttpStatusCode.OK, json)
            "/api/auth/login" -> respond("""{"token":"tok123","profile":{"id":"u1","name":"Izzan","isAdmin":true,"avatarColor":"#e57373"}}""", HttpStatusCode.OK, json)
            "/api/auth/logout" -> respond("", HttpStatusCode.NoContent)
            "/api/libraries" -> respond(
                """[{"id":"l1","name":"Movies","kind":"movie","paths":["/media/movies"],"createdAt":"2026-09-05T00:00:00.000Z","lastScannedAt":null}]""",
                HttpStatusCode.OK, json,
            )
            else -> respond("""{"statusCode":404,"error":"Not Found","message":"nope"}""", HttpStatusCode.NotFound, json)
        }
    }

    @Test
    fun `lists profiles, logs in, stores the session, and sends the token afterwards`() = runTest {
        val store = MemorySessionStore()
        val repo = AuthRepository(store, engine, deviceName = "test")
        val server = "http://server.test:8096/"

        assertEquals(false, repo.needsSetup(server))
        val profiles = repo.profiles(server)
        assertEquals(listOf("Izzan"), profiles.map { it.name })

        val session = repo.login(server, profiles.first().id, "1234")
        assertEquals("tok123", session.token)
        assertEquals("http://server.test:8096", session.serverUrl)
        assertTrue(session.isAdmin)
        assertNotNull(store.session.value)

        val libraries = repo.client().libraries.apiLibrariesGet().body()
        assertEquals(listOf("Movies"), libraries.map { it.name })
        assertEquals("movie", libraries.first().kind.value)
        assertEquals("Bearer tok123", seen.last { it.first == "/api/libraries" }.second)
        assertNull(seen.first { it.first == "/api/auth/profiles" }.second)

        repo.logout()
        assertNull(store.session.value)
        assertEquals("/api/auth/logout", seen.last().first)
    }

    @Test
    fun `image and token URLs are built from the server address`() {
        val store = MemorySessionStore()
        val client = ProjektorClient("http://s:8096/", { "abc" }, engine)
        assertEquals("http://s:8096/api/images/deadbeef?w=300", client.imageUrl("deadbeef", 300))
        assertNull(client.imageUrl(null, 300))
        assertEquals("http://s:8096/api/files/f1/stream?access_token=abc", client.withAccessToken("/api/files/f1/stream"))
        assertEquals("http://s:8096/x?a=1&access_token=abc", client.withAccessToken("/x?a=1"))
        assertNull(store.session.value)
    }
}
