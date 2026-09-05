# Android phone and TV apps

One Gradle project under `android/` builds two apps from shared modules:

| Module        | What                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `:core`       | API client generated from `packages/api-contract/openapi.json`, models, auth and token store, playback-decision helpers |
| `:player`     | Media3 ExoPlayer wrapper: direct play, HLS, sideloaded WebVTT, progress reporting                                       |
| `:app-mobile` | Phone app, Compose Material 3, `minSdk 24`                                                                              |
| `:app-tv`     | Android TV app, Compose for TV (`androidx.tv:tv-material`), leanback launcher, `minSdk 26`                              |

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
