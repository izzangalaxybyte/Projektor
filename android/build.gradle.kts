// Root build: plugins are declared here (apply false) and applied per module.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.openapi.generator) apply false
}

// Versions come from git. The latest tag named vMAJOR.MINOR.0 (e.g. v1.1.0) starts a version;
// versionName is MAJOR.MINOR.<commits since that tag>, so the build number starts over at 0 with
// each new version. Tag a commit to start a new one: a feature bumps MINOR, a big change MAJOR.
// versionCode is the commit count on the current branch, so it keeps rising across versions, as
// Android needs for an update to install. Both apps show versionName on the sign-in and home screens.
fun git(vararg args: String): String = providers.exec {
    commandLine("git", *args)
    isIgnoreExitValue = true
}.standardOutput.asText.get().trim()
val buildNumber = git("rev-list", "--count", "HEAD").toIntOrNull() ?: 1
val versionTag = git("describe", "--tags", "--match", "v[0-9]*.[0-9]*.0", "--abbrev=0")
val release = Regex("""^v(\d+)\.(\d+)\.0$""").find(versionTag)?.let { "${it.groupValues[1]}.${it.groupValues[2]}" } ?: "0.0"
val sinceRelease = if (versionTag.isEmpty()) buildNumber else git("rev-list", "--count", "$versionTag..HEAD").toIntOrNull() ?: 0
val versionName = "$release.$sinceRelease"
extra["projektorVersionCode"] = buildNumber
extra["projektorVersionName"] = versionName

// ./gradlew publishToApphound builds both release APKs and publishes them to apphound, the private
// store (~/Documents/GitHub/appster) that installs and updates them on devices. The changelog is
// the last commit's subject; store-icon.png is the store listing's icon (adaptive icons aren't
// extracted from the APK). A plain assembleRelease never publishes.
val apphoundDir = File(System.getProperty("user.home"), "Documents/GitHub/appster")
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
        val apk = file("$module/build/outputs/apk/release/Projektor-$flavor-$versionName-release.apk")
        commandLine(
            uv, "run", "--project", apphoundDir.path, File(apphoundDir, "scripts/publish.py").path,
            apk.path, "--name", storeName, "--changelog", changelog, "--icon", file("store-icon.png").path,
        )
    }
}
// Publishes update the store index with a conditional write, so two at once make one of them fail.
publishTasks.zipWithNext { earlier, later -> later.configure { mustRunAfter(earlier) } }
tasks.register("publishToApphound") {
    group = "publishing"
    description = "Builds and publishes the phone and TV release APKs to Appster."
    dependsOn(publishTasks)
}
