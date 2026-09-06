package app.projektor.core.items

import app.projektor.core.ProjektorClient
import app.projektor.core.bodyOrThrow
import app.projektor.core.api.models.ApiItemsGet200Response
import app.projektor.core.api.models.ItemDetail
import app.projektor.core.api.models.ItemKindInput
import app.projektor.core.api.models.ItemSummary
import app.projektor.core.api.models.LibraryKindInput
import app.projektor.core.api.models.PlaybackDecideRequestInput
import app.projektor.core.api.models.PlaybackDecision
import app.projektor.core.api.models.ProgressUpdateRequestInput

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

    suspend fun detail(id: String): ItemDetail = client.items.apiItemsIdGet(id).bodyOrThrow()

    suspend fun children(parentId: String): List<ItemSummary> = list(parentId = parentId, limit = 200).items

    suspend fun nextEpisode(episodeId: String): ItemSummary? = client.items.apiItemsIdNextGet(episodeId).bodyOrThrow()

    suspend fun decide(request: PlaybackDecideRequestInput): PlaybackDecision = client.playback.apiPlaybackDecidePost(request).bodyOrThrow()

    suspend fun reportProgress(itemId: String, positionMs: Long, durationMs: Long) {
        client.progress.apiProgressPost(ProgressUpdateRequestInput(itemId = itemId, positionMs = positionMs, durationMs = durationMs))
    }
}
