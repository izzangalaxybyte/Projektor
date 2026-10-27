package app.projektor.core.items

import app.projektor.core.ProjektorClient
import app.projektor.core.api.models.ApiFavoritesItemIdPutRequest
import app.projektor.core.api.models.ApiItemsGet200Response
import app.projektor.core.api.models.ApiProgressItemIdWatchedPutRequest
import app.projektor.core.api.models.ItemDetail
import app.projektor.core.api.models.ItemKindInput
import app.projektor.core.api.models.ItemSummary
import app.projektor.core.api.models.LibraryKindInput
import app.projektor.core.api.models.PlaybackDecideRequestInput
import app.projektor.core.api.models.PlaybackDecision
import app.projektor.core.api.models.ProgressUpdateRequestInput
import app.projektor.core.api.models.TrackChoiceRequestInput
import app.projektor.core.bodyOrThrow
import app.projektor.core.okOrThrow

/** Ergonomic browse calls over the generated client, which takes every query parameter positionally. */
class ItemsRepository(private val client: ProjektorClient) {
    suspend fun list(
        libraryKind: LibraryKindInput? = null,
        kind: ItemKindInput? = null,
        parentId: String? = null,
        search: String? = null,
        needsReview: Boolean? = null,
        sort: String? = null,
        offset: Int? = null,
        limit: Int? = null,
    ): ApiItemsGet200Response =
        client.items.apiItemsGet(libraryKind, kind, parentId, search, needsReview?.toString(), sort, offset?.toLong(), limit?.toLong()).bodyOrThrow()

    suspend fun recentlyAdded(libraryKind: LibraryKindInput, limit: Int = 20): List<ItemSummary> =
        list(libraryKind = libraryKind, sort = "added", limit = limit).items

    suspend fun continueWatching(libraryKind: LibraryKindInput? = null, limit: Int = 20): List<ItemSummary> =
        client.progress.apiProgressContinueGet(libraryKind, limit.toLong()).bodyOrThrow()

    /** Favorite movies and shows, most recently added first. */
    suspend fun favorites(libraryKind: LibraryKindInput? = null, limit: Int = 50): List<ItemSummary> =
        client.favorites.apiFavoritesGet(libraryKind, limit.toLong()).bodyOrThrow()

    /** Adds a movie or show to favorites, or removes it. */
    suspend fun setFavorite(itemId: String, favorite: Boolean) {
        client.favorites.apiFavoritesItemIdPut(itemId, ApiFavoritesItemIdPutRequest(favorite)).bodyOrThrow()
    }

    suspend fun detail(id: String): ItemDetail = client.items.apiItemsIdGet(id).bodyOrThrow()

    suspend fun children(parentId: String): List<ItemSummary> = list(parentId = parentId, limit = 200).items

    suspend fun nextEpisode(episodeId: String): ItemSummary? = client.items.apiItemsIdNextGet(episodeId).bodyOrThrow()

    suspend fun decide(request: PlaybackDecideRequestInput): PlaybackDecision = client.playback.apiPlaybackDecidePost(request).bodyOrThrow()

    /** Remembers an audio or subtitle pick for the file's show, so its other episodes start with it. */
    suspend fun rememberTrackChoice(fileId: String, audioStreamIndex: Long? = null, subtitleId: String? = null, subtitlesOff: Boolean? = null) {
        client.playback.apiPlaybackTrackChoicePost(TrackChoiceRequestInput(fileId, audioStreamIndex, subtitleId, subtitlesOff)).okOrThrow()
    }

    suspend fun reportProgress(itemId: String, positionMs: Long, durationMs: Long) {
        client.progress.apiProgressPost(ProgressUpdateRequestInput(itemId = itemId, positionMs = positionMs, durationMs = durationMs))
    }

    /** Marks a movie or episode watched (position at the end) or unwatched (progress cleared). */
    suspend fun setWatched(itemId: String, watched: Boolean) {
        // Unwatching answers `null` (no progress left), which the generated model cannot parse.
        client.progress.apiProgressItemIdWatchedPut(itemId, ApiProgressItemIdWatchedPutRequest(watched)).okOrThrow()
    }
}
