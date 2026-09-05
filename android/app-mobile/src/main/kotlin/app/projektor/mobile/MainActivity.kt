package app.projektor.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.projektor.mobile.ui.AppNav
import app.projektor.mobile.ui.ProjektorTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as ProjektorApp).container
        setContent { ProjektorTheme { AppNav(container) } }
    }
}
