// Root build: plugins are declared here (apply false) and applied per module.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.openapi.generator) apply false
}

// Every APK carries a build number so a tester can tell which build is installed: versionCode is
// the commit count on the current branch and versionName is 0.1.<count>-<short sha>. Both apps
// read these and show them on the sign-in and home screens.
fun git(vararg args: String): String = providers.exec { commandLine("git", *args) }.standardOutput.asText.get().trim()
val buildNumber = git("rev-list", "--count", "HEAD").toIntOrNull() ?: 1
val gitSha = git("rev-parse", "--short", "HEAD").ifEmpty { "unknown" }
extra["projektorVersionCode"] = buildNumber
extra["projektorVersionName"] = "0.1.$buildNumber-$gitSha"
