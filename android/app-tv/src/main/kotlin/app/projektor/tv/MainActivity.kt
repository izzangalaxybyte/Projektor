package app.projektor.tv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import app.projektor.tv.ui.TvNav
import app.projektor.tv.ui.TvTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val container = (application as TvApp).container
        setContent { TvTheme { TvNav(container) } }
    }
}
