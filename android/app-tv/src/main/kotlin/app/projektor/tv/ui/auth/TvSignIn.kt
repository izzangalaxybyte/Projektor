package app.projektor.tv.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.Alignment
import app.projektor.tv.BuildConfig
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Button
import androidx.tv.material3.Card
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import app.projektor.core.DEFAULT_SERVER_URL
import app.projektor.core.api.models.Profile
import app.projektor.tv.TvContainer
import app.projektor.tv.ui.userMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private sealed interface Step {
    data object Server : Step
    data class Setup(val server: String) : Step
    data class Profiles(val server: String, val profiles: List<Profile>) : Step
    data class Pin(val server: String, val profile: Profile) : Step
}

/** Server address → (first run: create admin) → profile → PIN, laid out for a 10-foot screen. */
@Composable
fun TvSignIn(container: TvContainer) {
    val savedServer by container.sessions.serverUrl.collectAsState()
    var step: Step by remember { mutableStateOf(Step.Server) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val focusManager = LocalFocusManager.current
    fun run(block: suspend () -> Unit) {
        error = null; busy = true
        scope.launch { try { block() } catch (e: Exception) { error = e.userMessage() } finally { busy = false } }
    }
    Column(Modifier.fillMaxSize().padding(48.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
            Text("Projektor", style = MaterialTheme.typography.displaySmall, color = MaterialTheme.colorScheme.primary)
            Text("Build ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("build-number"))
        }
        when (val s = step) {
            Step.Server -> {
                var url by remember { mutableStateOf(savedServer ?: DEFAULT_SERVER_URL) }
                val fieldFocus = remember { FocusRequester() }
                LaunchedEffect(Unit) { delay(100); runCatching { fieldFocus.requestFocus() } }
                Text("Where is your server?", color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(
                    value = url, onValueChange = { url = it }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                    modifier = Modifier.width(520.dp).testTag("server-url").focusRequester(fieldFocus).moveDownOnDpad(focusManager),
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
                Text("Create the first profile; it will be the admin.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(value = name, onValueChange = { name = it }, singleLine = true, modifier = Modifier.width(520.dp).moveDownOnDpad(focusManager))
                PinField(pin, Modifier.moveDownOnDpad(focusManager)) { pin = it }
                Button(enabled = !busy && name.isNotBlank() && pin.length >= 4, onClick = { run { container.auth.setup(s.server, name.trim(), pin) } }) { Text("Create") }
            }
            is Step.Profiles -> {
                Text("Who is watching?", color = MaterialTheme.colorScheme.onSurfaceVariant)
                val firstCard = remember { FocusRequester() }
                LaunchedEffect(s.profiles) { delay(100); runCatching { firstCard.requestFocus() } }
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    s.profiles.forEachIndexed { i, p ->
                        Card(onClick = { step = Step.Pin(s.server, p) }, modifier = Modifier.testTag("profile-${p.name}").let { if (i == 0) it.focusRequester(firstCard) else it }) {
                            Text(p.name, Modifier.padding(horizontal = 32.dp, vertical = 24.dp), style = MaterialTheme.typography.titleLarge)
                        }
                    }
                }
            }
            is Step.Pin -> {
                var pin by remember { mutableStateOf("") }
                val pinFocus = remember { FocusRequester() }
                LaunchedEffect(Unit) { delay(100); runCatching { pinFocus.requestFocus() } }
                Text("PIN for ${s.profile.name}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                PinField(pin, Modifier.focusRequester(pinFocus).moveDownOnDpad(focusManager)) { pin = it }
                Button(enabled = !busy && pin.length >= 4, modifier = Modifier.testTag("pin-submit"), onClick = { run { container.auth.login(s.server, s.profile.id, pin) } }) { Text("Sign in") }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("auth-error")) }
    }
}

@Composable
private fun PinField(value: String, modifier: Modifier = Modifier, onChange: (String) -> Unit) {
    val focusManager = LocalFocusManager.current
    OutlinedTextField(
        value = value, onValueChange = { onChange(it.filter(Char::isDigit).take(6)) }, singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { focusManager.moveFocus(FocusDirection.Down) }),
        modifier = modifier.width(320.dp).testTag("pin"),
    )
}

/**
 * Text fields swallow D-pad keys; on a TV the remote's Down must still leave the field. Also
 * treats the centre/Enter key as "next" so the on-screen keyboard is not needed to move on.
 */
private fun Modifier.moveDownOnDpad(focusManager: androidx.compose.ui.focus.FocusManager): Modifier = onPreviewKeyEvent { event ->
    if (event.type == KeyEventType.KeyDown && (event.key == Key.DirectionDown || event.key == Key.Tab)) {
        focusManager.moveFocus(FocusDirection.Down)
        true
    } else {
        false
    }
}
