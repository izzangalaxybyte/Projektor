package app.projektor.core.auth

import app.projektor.core.ProjektorClient
import app.projektor.core.bodyOrThrow
import app.projektor.core.api.models.LoginRequestInput
import app.projektor.core.api.models.Profile
import app.projektor.core.api.models.SetupRequestInput
import io.ktor.client.engine.HttpClientEngine

/** Setup, profile list, login, and logout against a server, writing the result to the store. */
class AuthRepository(
    private val store: SessionStore,
    private val engine: HttpClientEngine? = null,
    private val deviceName: String = "Android",
) {
    /** A client for the stored server that sends the stored token (if any). */
    fun client(serverUrl: String = requireNotNull(store.serverUrl.value) { "No server configured" }): ProjektorClient =
        ProjektorClient(serverUrl, { store.session.value?.token }, engine)

    suspend fun needsSetup(serverUrl: String): Boolean = client(serverUrl).auth.apiAuthSetupGet().bodyOrThrow().needsSetup

    suspend fun profiles(serverUrl: String): List<Profile> = client(serverUrl).auth.apiAuthProfilesGet().bodyOrThrow()

    suspend fun setup(serverUrl: String, name: String, pin: String): Session {
        val res = client(serverUrl).auth.apiAuthSetupPost(SetupRequestInput(name = name, pin = pin)).bodyOrThrow()
        return signIn(serverUrl, res.token, res.profile)
    }

    suspend fun login(serverUrl: String, profileId: String, pin: String): Session {
        val res = client(serverUrl).auth.apiAuthLoginPost(LoginRequestInput(profileId = profileId, pin = pin, deviceName = deviceName)).bodyOrThrow()
        return signIn(serverUrl, res.token, res.profile)
    }

    suspend fun logout() {
        val server = store.serverUrl.value
        if (server != null && store.session.value != null) runCatching { client(server).auth.apiAuthLogoutPost() }
        store.signOut()
    }

    private fun signIn(serverUrl: String, token: String, profile: Profile): Session {
        val session = Session(serverUrl.trimEnd('/'), token, profile.id, profile.name, profile.isAdmin)
        store.signIn(session)
        return session
    }
}
