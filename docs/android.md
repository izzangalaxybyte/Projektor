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

## Server address

`DEFAULT_SERVER_URL` in `:core` (`http://192.168.100.20:8096`) prefills the server field on first launch and is what a fresh install talks to. Edit the constant if the box moves; the field remains editable on the device too.

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

The Live tests (`LiveTest`, `TvLiveTest`) need the IPTV login pointed at the fake provider. The quickest host setup is the e2e server: `node e2e/start-server.mjs` starts the API on 8099 with the fake provider on 8098; then create the admin (`POST /api/auth/setup` with Izzan/1234), add and scan the three fixture libraries, and `PATCH /api/settings` with `iptvUrl http://127.0.0.1:8098`, `iptvUsername alice`, `iptvPassword secret`. Run the phone tests with `PROJEKTOR_SERVER_URL=http://10.0.2.2:8099` and the TV tests with `adb reverse tcp:8099 tcp:8099` and `PROJEKTOR_SERVER_URL=http://127.0.0.1:8099`; with two emulators attached, set `ANDROID_SERIAL` to pick one.

The server address defaults to `http://10.0.2.2:8096` (the host as seen from an emulator); set `PROJEKTOR_SERVER_URL` for a physical device. To create an emulator with the SDK tools: install `system-images;android-35;google_apis;arm64-v8a` with `sdkmanager`, `avdmanager create avd -n projektor_phone -k <image> -d pixel_6`, and start it with `emulator -avd projektor_phone` (add `-no-window` for headless runs).

## Phone app

`:app-mobile` is Compose Material 3 with Compose Navigation. `AppNav` shows the sign-in flow (server address, first-run setup or profile picker, PIN) until a session exists, then a bottom-tab scaffold: Home (continue watching and recently added per library kind, so anime never mixes with TV), Movies, TV, Anime (adaptive poster grids), Search (debounced), and an item detail destination with Play/Resume, next episode, seasons and episodes, and file details. Dependencies are wired by hand in `AppContainer` on the `Application`; screens fetch through `ItemsRepository` in `LaunchedEffect`s and render a small `UiState`. Artwork loads with Coil from the public image route. `BrowseTest` is a Compose UI test that walks the whole flow on an emulator against a real server (`./gradlew :app-mobile:connectedDebugAndroidTest`).

## Phone player

`PlayerScreen` is the fullscreen player. It asks the server for a decision with the device profile, loads the result into `ProjektorPlayer` inside a Media3 `PlayerView` with the built-in controller disabled, and draws its own controls: skip back, play/pause, and skip forward in the centre (double tap on either half of the screen skips too), and a bottom bar with the seek slider, the **skip amount** picker (+3 to +15 seconds), the **speed** picker (0.5× to 2×), and audio and subtitle pickers. The skip and speed choices come from `PlayerPrefs` and persist per device. Changing the audio track asks for a new decision from the current position. Progress reports go through `ProjektorPlayer`; at the end of an episode a "Play next episode" button appears. `PlayerTest` exercises the skip and speed behaviour on an emulator.

## Live TV on the phone

The Live tab (`ui/live/LiveScreen.kt`) lists categories as filter chips over channel rows with logo, number, what is on now with a progress bar, what is next, and a catch-up marker, refreshing every minute; an unconfigured server shows a pointer to Settings. `LivePlayerScreen` asks `POST /api/live/decide` with the device profile, which lists the `ts` container, so channels arrive as the raw MPEG-TS relay and ExoPlayer plays them with the `video/mp2t` MIME type set (`liveMediaSpecFor`). There is no seek bar: channel down and up buttons switch channels in place (the list wraps), the Guide button opens the day's programmes, and finished programmes on a catch-up channel have a Watch button that opens `CatchupPlayerScreen`, the seekable provider player with the same skip-amount and speed pickers as the file player. `LiveRepository` in `:core` wraps the generated `LiveApi`; `LiveGuide` holds the pure helpers (ISO parsing without java.time, since the phone's minSdk is 24; progress, wall clock, neighbour, number lookup, archive window) with unit tests.

## Recording on the phone

The live player's bottom bar has ● Rec (record this channel until stopped) and each guide programme that has not ended has ● Record or ● Schedule; a short notice confirms what the server did. The Recordings button on the Live tab opens `ui/live/RecordingsScreen.kt`: state, channel, times, size, Play (done, running, or a failed recording with bytes), Stop, Cancel, Delete, polling every three seconds while anything is active. Recordings play in `CatchupPlayerScreen` with `ProviderSource.Recording`, so the skip-amount and speed controls apply. `RecordingTest` records from the player, stops it under Recordings, plays it, and deletes it.

## TV app

`:app-tv` uses Compose for TV (`androidx.tv:tv-material`). Sign-in is the same three steps as the phone but laid out for a 10-foot screen, with the remote in mind: D-pad Down (or the keyboard's Next) leaves a text field, the first profile card and the PIN field take focus on arrival. `TvHome` shows tv-material tabs (Home, Movies, TV Shows, Anime, Search) over rows of `TvTile` cards, which scale and outline on focus; the first tile of the first row requests focus from inside its own composition, so browsing starts on something without hunting. Grids and search sit behind the other tabs. `TvItemScreen` focuses Play on arrival and lists seasons and episodes as rows below the details.

Two TV-specific lessons are baked in: tv-material buttons respond to key events, not to touch-style clicks, so tests drive them with `UiDevice.pressKeyCode`; and the Android TV emulator image does not route `10.0.2.2` to the host, so run `adb reverse tcp:8096 tcp:8096` and point the app (or `PROJEKTOR_SERVER_URL`) at `http://127.0.0.1:8096`. Create the emulator with `sdkmanager --install "system-images;android-34;android-tv;arm64-v8a"` and `avdmanager create avd -n projektor_tv -k <image> -d tv_1080p`.

## Live TV on the TV

The Live tab (`ui/live/TvLive.kt`) shows category buttons over a focusable channel list; the first channel takes focus itself. `TvLivePlayerScreen` is remote-driven: D-pad Up/Down and Channel Up/Down change channel, digits jump to a channel number after a short pause, Right opens the guide as a side list whose finished, archived programmes are buttons that open `TvCatchupScreen`, Centre pauses while the info bar is showing, Back closes the guide then leaves. `TvCatchupScreen` behaves like the TV file player: Left/Right skip by the chosen amount with the bar hidden, Up/Down shows the bar with the skip and speed pickers.

## Recording on the TV

The remote's record key (`KEYCODE_MEDIA_RECORD`) starts recording the current channel until stopped, or stops the recording already running on it; a ● REC mark shows while one runs. In the guide, Centre on a programme that has not ended records or schedules it. The Recordings button on the Live tab opens `ui/live/TvRecordings.kt`, a focusable list where Centre opens Play / Stop / Cancel / Delete for the row; playback goes through `TvCatchupScreen` with a `recordingId`. `TvRecordTest` records for 15 seconds with the record key, stops, finds the recording under Recordings, and plays it.

## TV player

`TvPlayerScreen` is driven by the remote. With the controls hidden, Left and Right jump by the chosen skip amount, Centre toggles play/pause, and Up/Down reveals the control bar; the media keys (play/pause, rewind, fast-forward) work regardless. The control bar holds skip back, play/pause, skip forward, and buttons that open a side list for the **skip amount** (+3 to +15 seconds), the **speed** (0.5× to 2×), the audio track, and subtitles; Back closes the list, then the bar, then the player. Both choices persist through `PlayerPrefs`, shared with the phone app. When an episode ends, "Play next episode" takes focus and starts on its own after a ten-second countdown. `TvPlayerTest` checks the remote behaviour on an emulator: Right jumps 10 s by default, 4 s after picking +4s, Left returns, and the speed picker stores 1.5×.

## Building

Requirements: the Android SDK (platform 36 and build tools; Android Studio installs them) and a JDK 17 to 21. Android Studio's bundled JDK works:

```bash
cd android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
./gradlew assembleDebug
```

`local.properties` (gitignored) points `sdk.dir` at the SDK; Android Studio writes it, or create it with `sdk.dir=/Users/you/Library/Android/sdk`. Debug APKs land in `app-mobile/build/outputs/apk/debug/` and `app-tv/build/outputs/apk/debug/`.

Every APK carries a build number taken from git at build time: `versionCode` is the commit count on the current branch and `versionName` is `0.1.<count>-<short sha>` (root `build.gradle.kts`). The file is named after it, `Projektor-phone-0.1.118-05856a1-debug.apk`, and both apps show "Build 0.1.118-05856a1" on the sign-in screen and the home screen, so a tester can tell at a glance which build is installed. Build from the merged `main` before handing out an APK so the number matches a commit in the repo.

The generated client maps JSON `number` to `Double` and `integer` to `Long` (`typeMappings` in `core/build.gradle.kts`). The generator's defaults were `BigDecimal`, which kotlinx.serialization cannot decode, and `Int`, which a 7 GB file's `sizeBytes` overflows; the contract's integers are JS safe integers, so `Long` is the honest type.

## Installing

```bash
adb install -r app-mobile/build/outputs/apk/debug/Projektor-phone-*-debug.apk
adb install -r app-tv/build/outputs/apk/debug/Projektor-tv-*-debug.apk
```

For the TV, enable developer options and network debugging on the device, then `adb connect <tv-ip>:5555` first. The TV app appears in the leanback launcher with the Projektor banner.

## Emulators

An Android TV system image (API 34 or newer, "Android TV (1080p)") and a phone image both work for development. Media3 on the emulator decodes H.264 and AAC; it usually lacks AC3 and HEVC, which is exactly the case that exercises the server's transcode path.

## Versions

Gradle 9.2.1 (wrapper), Android Gradle Plugin 8.13, Kotlin 2.2, Compose BOM 2025.09, Compose for TV 1.0.1, Media3 1.8. The version catalog is `android/gradle/libs.versions.toml`.
