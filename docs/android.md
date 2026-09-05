# Android phone and TV apps

One Gradle project under `android/` builds two apps from shared modules:

| Module        | What                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `:core`       | API client generated from `packages/api-contract/openapi.json`, models, auth and token store, playback-decision helpers |
| `:player`     | Media3 ExoPlayer wrapper: direct play, HLS, sideloaded WebVTT, progress reporting                                       |
| `:app-mobile` | Phone app, Compose Material 3, `minSdk 24`                                                                              |
| `:app-tv`     | Android TV app, Compose for TV (`androidx.tv:tv-material`), leanback launcher, `minSdk 26`                              |

## API client

`:core` generates its Kotlin client from `packages/api-contract/openapi.json` at build time with the OpenAPI Generator Gradle plugin (`kotlin` generator, `jvm-ktor` library, kotlinx.serialization). Nothing generated is committed, so the Kotlin types can never drift from the contract; regenerate the contract on the server side and the next Gradle build picks it up. `ProjektorClient` wraps the generated `*Api` classes with one base URL and a bearer token read per request, plus `imageUrl` and `withAccessToken` for URLs a player fetches itself. `SessionStore` keeps server address, token, and profile in SharedPreferences (`MemorySessionStore` for tests); `AuthRepository` does setup, profiles, login, and logout.

## Device profile

`DeviceProfiles` (in `:core`) turns the device's `MediaCodecList` into the server's `DeviceProfile`: decoder MIME types map to `h264`, `hevc`, `vp9`, `av1`, `aac`, `ac3`, `eac3`, `opus`, `mp3`, `flac`; containers are what Media3 demuxes (mp4, mkv, webm, mov, ts, avi); segments are fMP4. The mapping is a pure function so it is unit tested with synthetic decoder lists; only `DeviceProfiles.current()` touches Android.

## Player

`:player` wraps Media3 ExoPlayer in `ProjektorPlayer`: `load(spec, startMs, rate, knownDurationMs)`, play/pause/toggle, `seekTo`, `skip(deltaMs)` for the chosen skip amount, `setRate`, `selectSubtitle`, and a `StateFlow<PlayerState>` for Compose. Progress is reported through a callback every ten seconds while playing and on pause, end, and release. `mediaSpecFor(decision, client)` decides what ExoPlayer loads: direct play streams the file with every text subtitle sideloaded as WebVTT; remux and transcode load the HLS master, whose subtitle renditions the server lists itself. Both URLs carry `?access_token=`. `PlayerPrefs` in `:core` holds the skip amount and speed (same options as the web player) in SharedPreferences.

`ItemsRepository` in `:core` gives the browse and playback calls named optional parameters; the generated client takes every query parameter positionally. `bodyOrThrow()` turns non-2xx responses into `ApiException` with the server's message instead of a deserialization failure.

## Instrumented tests

`PlaybackInstrumentedTest` in `:player` plays a fixture on a connected device or emulator against a real server. Run the API on the host with the fixtures scanned, then:

```bash
./gradlew :player:connectedDebugAndroidTest
```

The server address defaults to `http://10.0.2.2:8096` (the host as seen from an emulator); set `PROJEKTOR_SERVER_URL` for a physical device. To create an emulator with the SDK tools: install `system-images;android-35;google_apis;arm64-v8a` with `sdkmanager`, `avdmanager create avd -n projektor_phone -k <image> -d pixel_6`, and start it with `emulator -avd projektor_phone` (add `-no-window` for headless runs).

## Building

Requirements: the Android SDK (platform 36 and build tools; Android Studio installs them) and a JDK 17 to 21. Android Studio's bundled JDK works:

```bash
cd android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
./gradlew assembleDebug
```

`local.properties` (gitignored) points `sdk.dir` at the SDK; Android Studio writes it, or create it with `sdk.dir=/Users/you/Library/Android/sdk`. Debug APKs land in `app-mobile/build/outputs/apk/debug/` and `app-tv/build/outputs/apk/debug/`.

## Installing

```bash
adb install -r app-mobile/build/outputs/apk/debug/app-mobile-debug.apk
adb install -r app-tv/build/outputs/apk/debug/app-tv-debug.apk
```

For the TV, enable developer options and network debugging on the device, then `adb connect <tv-ip>:5555` first. The TV app appears in the leanback launcher with the Projektor banner.

## Emulators

An Android TV system image (API 34 or newer, "Android TV (1080p)") and a phone image both work for development. Media3 on the emulator decodes H.264 and AAC; it usually lacks AC3 and HEVC, which is exactly the case that exercises the server's transcode path.

## Versions

Gradle 9.2.1 (wrapper), Android Gradle Plugin 8.13, Kotlin 2.2, Compose BOM 2025.09, Compose for TV 1.0.1, Media3 1.8. The version catalog is `android/gradle/libs.versions.toml`.
