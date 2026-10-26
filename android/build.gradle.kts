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

// ./gradlew publishToApphound builds both release APKs and publishes them to apphound, the private
// store (~/Documents/GitHub/apphound) that installs and updates them on devices. The changelog is
// the last commit's subject; store-icon.png is the store listing's icon (adaptive icons aren't
// extracted from the APK). A plain assembleRelease never publishes.
val apphoundDir = File(System.getProperty("user.home"), "Documents/GitHub/apphound")
val uv = listOf("/opt/homebrew/bin/uv", "/usr/local/bin/uv").firstOrNull { File(it).exists() } ?: "uv"
val changelog = git("log", "-1", "--pretty=%s")
val apphoundApps = listOf(
    Triple("app-mobile", "phone", "Projektor"),
    Triple("app-tv", "tv", "Projektor TV"),
)
val publishTasks = apphoundApps.map { (module, flavor, storeName) ->
    tasks.register<Exec>("publish${flavor.replaceFirstChar { it.uppercase() }}ToApphound") {
        group = "publishing"
        description = "Publishes the $flavor release APK to apphound as \"$storeName\"."
        dependsOn(":$module:assembleRelease")
        val apk = file("$module/build/outputs/apk/release/Projektor-$flavor-0.1.$buildNumber-$gitSha-release.apk")
        commandLine(
            uv, "run", "--project", apphoundDir.path, File(apphoundDir, "scripts/publish.py").path,
            apk.path, "--name", storeName, "--changelog", changelog, "--icon", file("store-icon.png").path,
        )
    }
}
tasks.register("publishToApphound") {
    group = "publishing"
    description = "Builds and publishes the phone and TV release APKs to apphound."
    dependsOn(publishTasks)
}
