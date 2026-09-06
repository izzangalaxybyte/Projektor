// Shared between the phone and TV apps: API client, models, auth, playback decisions.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.openapi.generator)
}

// The API client is generated from the frozen contract at build time, never committed, so the
// Kotlin types can never drift from packages/api-contract/openapi.json.
val generatedDir = layout.buildDirectory.dir("generated/openapi")
openApiGenerate {
    generatorName.set("kotlin")
    library.set("jvm-ktor")
    inputSpec.set(rootProject.file("../packages/api-contract/openapi.json").absolutePath)
    outputDir.set(generatedDir.map { it.asFile.absolutePath })
    packageName.set("app.projektor.core.api")
    // Plain JSON numbers (rating, score) decode as Double. The generator's default is
    // java.math.BigDecimal, which kotlinx.serialization has no serializer for, so the first
    // item with a rating crashed the app.
    // Integers are 64-bit: the contract's integers are JS safe integers (up to 2^53) and file
    // sizes and durations pass 2^31, which the generator's default Int rejected at parse time.
    typeMappings.set(mapOf("number" to "kotlin.Double", "BigDecimal" to "kotlin.Double", "integer" to "kotlin.Long"))
    additionalProperties.set(
        mapOf(
            "serializationLibrary" to "kotlinx_serialization",
            "dateLibrary" to "string",
            "omitGradleWrapper" to "true",
            "enumPropertyNaming" to "UPPERCASE",
        ),
    )
    globalProperties.set(mapOf("apis" to "", "models" to "", "supportingFiles" to "", "modelDocs" to "false", "apiDocs" to "false"))
}

android {
    namespace = "app.projektor.core"
    compileSdk = libs.versions.compileSdk.get().toInt()
    defaultConfig { minSdk = libs.versions.minSdkMobile.get().toInt() }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets["main"].kotlin.srcDir(generatedDir.map { it.dir("src/main/kotlin") })
    testOptions.unitTests.isReturnDefaultValues = true
}
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach { dependsOn("openApiGenerate") }
// Target 17 byte code from whichever JDK runs Gradle (Android Studio ships 21); no toolchain pin
// so the build never depends on a second JDK being installed.
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    testImplementation(libs.junit)
    testImplementation(libs.ktor.client.mock)
    testImplementation(libs.kotlinx.coroutines.test)
}
