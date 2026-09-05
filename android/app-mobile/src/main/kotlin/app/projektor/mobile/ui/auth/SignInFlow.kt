package app.projektor.mobile.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import app.projektor.core.api.models.Profile
import app.projektor.mobile.AppContainer
import app.projektor.mobile.ui.userMessage
import kotlinx.coroutines.launch

private sealed interface Step {
    data object Server : Step
    data class Setup(val server: String) : Step
    data class Profiles(val server: String, val profiles: List<Profile>) : Step
    data class Pin(val server: String, val profile: Profile) : Step
}

/** Server address → (first run: create admin) → profile → PIN. Writes the session into the store. */
@Composable
fun SignInFlow(container: AppContainer) {
    val savedServer by container.sessions.serverUrl.collectAsState()
    var step: Step by remember { mutableStateOf(Step.Server) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun run(block: suspend () -> Unit) {
        error = null
        busy = true
        scope.launch {
            try { block() } catch (e: Exception) { error = e.userMessage() } finally { busy = false }
        }
    }

    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Projektor", style = MaterialTheme.typography.headlineLarge, color = MaterialTheme.colorScheme.primary)
        when (val s = step) {
            Step.Server -> {
                var url by remember { mutableStateOf(savedServer ?: "http://") }
                Text("Where is your server?", color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(
                    value = url, onValueChange = { url = it }, label = { Text("Server address") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth().testTag("server-url"),
                )
                Button(enabled = !busy && url.length > 8, modifier = Modifier.testTag("server-continue"), onClick = {
                    run {
                        val server = url.trim().trimEnd('/')
                        container.sessions.setServerUrl(server)
                        step = if (container.auth.needsSetup(server)) Step.Setup(server) else Step.Profiles(server, container.auth.profiles(server))
                    }
                }) { Text("Continue") }
            }
            is Step.Setup -> {
                var name by remember { mutableStateOf("") }
                var pin by remember { mutableStateOf("") }
                Text("Welcome. Create the first profile; it will be the admin.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                PinField(pin, { pin = it })
                Button(enabled = !busy && name.isNotBlank() && pin.length >= 4, onClick = { run { container.auth.setup(s.server, name.trim(), pin) } }) { Text("Create") }
                TextButton(onClick = { step = Step.Server }) { Text("Back") }
            }
            is Step.Profiles -> {
                Text("Who is watching?", color = MaterialTheme.colorScheme.onSurfaceVariant)
                LazyVerticalGrid(columns = GridCells.Adaptive(140.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(s.profiles, key = { it.id }) { p ->
                        Card(onClick = { step = Step.Pin(s.server, p) }, modifier = Modifier.testTag("profile-${p.name}")) {
                            Text(p.name, Modifier.padding(20.dp), style = MaterialTheme.typography.titleMedium)
                        }
                    }
                }
                TextButton(onClick = { step = Step.Server }) { Text("Change server") }
            }
            is Step.Pin -> {
                var pin by remember { mutableStateOf("") }
                Text("PIN for ${s.profile.name}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                PinField(pin, { pin = it })
                Button(enabled = !busy && pin.length >= 4, modifier = Modifier.testTag("pin-submit"), onClick = { run { container.auth.login(s.server, s.profile.id, pin) } }) { Text("Sign in") }
                TextButton(onClick = { step = Step.Profiles(s.server, listOf()); run { step = Step.Profiles(s.server, container.auth.profiles(s.server)) } }) { Text("Back") }
            }
        }
        if (busy) CircularProgressIndicator()
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("auth-error")) }
    }
}

@Composable
private fun PinField(value: String, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = { onChange(it.filter(Char::isDigit).take(6)) },
        label = { Text("PIN") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        modifier = Modifier.fillMaxWidth().testTag("pin"),
    )
}
