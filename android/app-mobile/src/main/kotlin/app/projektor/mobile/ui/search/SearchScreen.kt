package app.projektor.mobile.ui.search

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import app.projektor.core.api.models.ItemSummary
import app.projektor.mobile.AppContainer
import app.projektor.mobile.ui.library.ItemGrid
import kotlinx.coroutines.delay

@Composable
fun SearchScreen(container: AppContainer, openItem: (String) -> Unit, modifier: Modifier = Modifier) {
    val items = container.items() ?: return
    val client = container.client() ?: return
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<ItemSummary>>(emptyList()) }
    LaunchedEffect(query) {
        if (query.trim().length < 2) { results = emptyList(); return@LaunchedEffect }
        delay(250)
        results = runCatching { items.list(search = query.trim(), limit = 60).items }.getOrDefault(emptyList())
    }
    Column(modifier.fillMaxSize()) {
        OutlinedTextField(value = query, onValueChange = { query = it }, label = { Text("Search titles") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(16.dp).testTag("search"))
        ItemGrid(null, results, client, openItem)
    }
}
