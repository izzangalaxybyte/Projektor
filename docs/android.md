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

`:player` wraps Media3 ExoPlayer in `ProjektorPlayer`: `load(spec, startMs, rate, knownDurationMs)`, play/pause/toggle, `seekTo`, `skip(deltaMs)` for the chosen skip amount, `setRate`, `selectSubtitle`, and a `StateFlow<PlayerState>` for Compose. Progress is reported through a callback every ten seconds while playing and on pause, end, and release. `mediaSpecFor(decision, client)` decides what ExoPlayer loads: direct play streams the file and remux and transcode load the HLS master; either way every text subtitle is sideloaded, ASS and SSA as the original script (drawn by libass-android with the fonts attached to the file, which `ProjektorPlayer` fetches from the server) and the rest as WebVTT. Both URLs carry `?access_token=`. `PlayerPrefs` in `:core` holds the skip amount and speed (same options as the web player) in SharedPreferences.

`ItemsRepository` in `:core` gives the browse and playback calls named optional parameters; the generated client takes every query parameter positionally. `bodyOrThrow()` turns non-2xx responses into `ApiException` with the server's message instead of a deserialization failure.

## Instrumented tests

`PlaybackInstrumentedTest` in `:player` plays a fixture on a connected device or emulator against a real server. Run the API on the host with the fixtures scanned, then:

```bash
./gradlew :player:connectedDebugAndroidTest
```

The Live tests (`LiveTest`, `TvLiveTest`) need the IPTV login pointed at the fake provider. The quickest host setup is the e2e server: `node e2e/start-server.mjs` starts the API on 8099 with the fake provider on 8098; then create the admin (`POST /api/auth/setup` with Izzan/1234), add and scan the three fixture libraries, and `PATCH /api/settings` with `iptvUrl http://127.0.0.1:8098`, `iptvUsername alice`, `iptvPassword secret`. Run the phone tests with `PROJEKTOR_SERVER_URL=http://10.0.2.2:8099` and the TV tests with `adb reverse tcp:8099 tcp:8099` and `PROJEKTOR_SERVER_URL=http://127.0.0.1:8099`; with two emulators attached, set `ANDROID_SERIAL` to pick one.

The server address defaults to `http://10.0.2.2:8096` (the host as seen from an emulator); set `PROJEKTOR_SERVER_URL` for a physical device. To create an emulator with the SDK tools: install `system-images;android-35;google_apis;arm64-v8a` with `sdkmanager`, `avdmanager create avd -n projektor_phone -k <image> -d pixel_6`, and start it with `emulator -avd projektor_phone` (add `-no-window` for headless runs).

## Phone app

`:app-mobile` is Compose Material 3 with Compose Navigation. `AppNav` shows the sign-in flow (server address, then first-run setup or the profile picker, where tapping a profile signs in) until a session exists, then a bottom-tab scaffold: Home (continue watching and recently added per library kind, so anime never mixes with TV, plus a Favorites row; pull down to refresh after changes made on another device), Movies, TV, Anime (adaptive poster grids with a sort menu and genre chips: A–Z, recently added, newest, top rated, and for anime the AniList, MyAnimeList and TMDB scores and popularity, with the score shown under each poster; a More tags… chip opens the AniList tags. Several chips narrow to titles with all of them. Each tab remembers its choices, loads every page rather than the first 200, and keeps its scroll position when you come back from a title), Search (debounced), and an item detail destination with a favorite heart on movies and shows, Play/Resume, next episode, seasons and episodes, and file details. Dependencies are wired by hand in `AppContainer` on the `Application`; screens fetch through `ItemsRepository` in `LaunchedEffect`s and render a small `UiState`. Artwork loads with Coil from the public image route. `BrowseTest` is a Compose UI test that walks the whole flow on an emulator against a real server (`./gradlew :app-mobile:connectedDebugAndroidTest`).

## Downloads on the phone

Downloads work the way Netflix and Plex do them: the original file, byte for byte (no transcode), kept in the app's own storage (`Android/data/app.projektor.mobile/files/downloads/<item>/`, no permission needed, removed with the app) and played by the app's own player without the server.

- **Starting one.** Movies and episodes have a download panel under Play (it asks which version when there are several); every episode in a season list has a download icon; seasons have "Download season", which queues the episodes not already on the phone (first version of each).
- **The icon** is an arrow before, a ring that fills while downloading (tap: cancel), a pin once it is on the phone (tap: play or delete), a warning on failure (tap: retry or remove).
- **Downloads tab.** Movies as rows, shows folded into one row each that opens onto their episodes, each with status, size and how far it has been watched; space used and free sits at the top. When Home cannot reach the server and there are downloads, it offers a way there.
- **Offline playback.** `PlayerScreen` checks `DownloadStore.playable(fileId)` first, so any Play of a downloaded file plays the local copy. Subtitles are saved alongside (the server's WebVTT copies, or the original ASS script plus the file's fonts for libass), because Media3 cannot read the compressed subtitle tracks some MKVs carry. Up next is the next downloaded episode of the show, else the server's when it can be reached. The position is saved on the phone and reported to the server when it is reachable.
- **Notifications.** While anything is downloading, an ongoing "Downloading <title>" notification shows the progress of the one under way and how many wait behind it (`DownloadService` runs under it). When one ends the app posts "Downloaded" or "Download failed" (`DownloadNotifications`); tapping either opens the Downloads tab (`EXTRA_OPEN_DOWNLOADS` → `AppContainer.openDownloads`). On Android 13+ the notification permission is asked once, when the first download starts; without it downloads still work, silently.

`download/Downloads.kt` holds `DownloadStore` (in `AppContainer`): the item and file models as the server described them, serialized to `downloads.json`. The app moves the bytes itself (`download/Transfer.kt`): one download at a time, oldest first, the video starting at once with the subtitles, fonts (fetched once per file, not once per ASS track) and artwork coming down beside it, into a `.part` file that a dropped connection resumes with a Range request after waiting it out (shown as "Waiting for network"; it fails after about ten minutes without progress). `DownloadService`, a `dataSync` foreground service, keeps the app alive while either store has anything left and stops itself after. Downloads left unfinished when the app closed start again in line when it next opens (`resume()`). The system `DownloadManager` did this at first, but on some phones its jobs never ran: the download sat at "Queued" and the server never saw a request for the file. Entries an older version handed to it are taken back from it on start. `ui/downloads/` has the icon, the item-page panel and the tab.

## Phone player

`PlayerScreen` is the fullscreen player. It asks the server for a decision with the device profile, loads the result into `ProjektorPlayer` inside a Media3 `PlayerView` with the built-in controller disabled, and draws its own controls: skip back, play/pause, and skip forward in the centre (double tap on either half of the screen skips too), and a bottom bar with the seek slider, the **skip amount** picker (+3 to +15 seconds), the **speed** picker (0.5× to 2×), and audio and subtitle pickers. The skip and speed choices come from `PlayerPrefs` and persist per device. Changing the audio track asks for a new decision from the current position. Progress reports go through `ProjektorPlayer`; at the end of an episode a "Play next episode" button appears. `PlayerTest` exercises the skip and speed behaviour on an emulator.

## Live TV on the phone

The Live tab (`ui/live/LiveScreen.kt`) lists categories as filter chips over channel rows with logo, number, what is on now with a progress bar, what is next, and a catch-up marker, refreshing every minute; an unconfigured server shows a pointer to Settings. `LivePlayerScreen` asks `POST /api/live/decide` with the device profile, which lists the `ts` container, so channels arrive as the raw MPEG-TS relay and ExoPlayer plays them with the `video/mp2t` MIME type set (`liveMediaSpecFor`). There is no seek bar: channel down and up buttons switch channels in place (the list wraps), the Guide button opens the day's programmes, and finished programmes on a catch-up channel have a Watch button that opens `CatchupPlayerScreen`, the seekable provider player with the same skip-amount and speed pickers as the file player. `LiveRepository` in `:core` wraps the generated `LiveApi`; `LiveGuide` holds the pure helpers (ISO parsing without java.time, since the phone's minSdk is 24; progress, wall clock, neighbour, number lookup, archive window) with unit tests.

## Recording on the phone

The live player's bottom bar has ● Rec (record this channel until stopped) and each guide programme that has not ended has ● Record or ● Schedule; a short notice confirms what the server did. The Recordings button on the Live tab opens `ui/live/RecordingsScreen.kt`: state, channel, times, size, Play (done, running, or a failed recording with bytes), Stop, Cancel, Delete, polling every three seconds while anything is active. Recordings play in `CatchupPlayerScreen` with `ProviderSource.Recording`, so the skip-amount and speed controls apply. `RecordingTest` records from the player, stops it under Recordings, plays it, and deletes it.

## Comics on the phone

The Comics tab (`ui/comics/ComicsScreen.kt`) shows Continue reading, Recently read (with a full history screen) and every series, searchable and sorted A–Z, recently added or recently read. All / Comics / Manga chips narrow every row of the tab; manga is whatever the server says reads right to left (ComicInfo's manga tag, or a book under a `Manga` folder). The choice is remembered across launches. The tab as last loaded is kept in memory, so coming back from a series draws the grid at once and keeps its scroll position while a fresh copy loads (a loading spinner in its place used to shrink the grid and clamp it to the top). A series page lists its books in the server's reading order with covers, page counts, read markers and progress, a Continue button, Download all, and mark read/unread. Without the server the tab lists the downloaded comics instead.

`ComicReaderScreen` is the CDisplayEx-style reader. Paged reading runs left to right or right to left (manga: the pager, tap zones, page slider and thumbnail strip all mirror); vertical scroll suits webtoons. Pages show one at a time, two side by side, or two in landscape only; in two-page mode the cover can stand alone so printed spreads face each other, the pairing can be shifted by a page for misaligned books, and pages that are themselves double-page scans (detected from their shape once loaded) always stand alone. Pages fit the screen (pinch, double-tap and pan zoom through Telephoto's `Modifier.zoomable`), the width, the height, or show at original size. Tap the outer thirds to turn pages and the middle for the controls; volume keys, arrow keys and page keys turn pages too. The controls carry a page slider, a thumbnail strip, a grid of every page, previous and next book, and quick switches for direction, page mode and fit; the settings panel adds background colour, brightness, contrast, saturation, grayscale, sepia and inverted (night) colours, screen rotation, and animation. Settings are kept per series (`ReaderPrefs`), and a change becomes the default for new series except the direction. Past the last page the reader offers the next book.

Pages come from a `PageSource`: from the server the archive pages are the original images, untouched (PDF pages are rendered at 1.25× the screen's long side); a download is read on the phone, a CBZ through `ZipFile` and a PDF through `PdfRenderer`, both behind Coil fetchers in the reader's own `ImageLoader` (`comics/PageSources.kt`). Pages load at up to twice the screen size (every pixel at original size), and the next four are fetched ahead.

Progress is saved on the phone first (`ComicProgressStore`) and sent to the server; pages read offline are sent later, stamped with when they were read, so the server keeps whichever is newer. The reader starts from the newer of the two, and a finished book starts over. Comic downloads (`ComicDownloadStore`) work like the video ones (the app's own transfer under `DownloadService`, app storage, the "Downloaded" notification) and appear in the Downloads tab under Comics & manga.

## TV app

`:app-tv` uses Compose for TV (`androidx.tv:tv-material`). Sign-in is the same steps as the phone but laid out for a 10-foot screen, with the remote in mind: D-pad Down (or the keyboard's Next) leaves a text field, the first profile card takes focus on arrival. `TvHome` shows tv-material tabs (Home, Movies, TV Shows, Anime, Search) over rows of `TvTile` cards, which scale and outline on focus; the first tile of the first row requests focus from inside its own composition, so browsing starts on something without hunting. Grids and search sit behind the other tabs. Home has a Favorites row after continue watching. `TvItemScreen` has a Favorite button on movies and shows, focuses Play on arrival and lists seasons and episodes as rows below the details.

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

## Publishing to apphound

Release builds are signed with the apphound release key through `android/keystore.properties` (gitignored; `storeFile`, `storePassword`, `keyAlias`). Keep that key forever: devices refuse an update signed with a different one. To build both release APKs and publish them to the apphound store, which installs and updates them over the air:

```bash
./gradlew publishToApphound
```

The phone app is listed as "Projektor" and the TV app as "Projektor TV"; the changelog is the last commit's subject. `publishPhoneToApphound` and `publishTvToApphound` publish one app each. The store refuses a `versionCode` that is not higher than the published one, so commit before publishing again (the build number is the commit count). A plain `assembleRelease` never publishes.

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
