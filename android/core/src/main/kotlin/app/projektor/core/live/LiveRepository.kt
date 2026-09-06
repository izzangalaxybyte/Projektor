package app.projektor.core.live

import app.projektor.core.ProjektorClient
import app.projektor.core.api.models.IptvMovie
import app.projektor.core.api.models.IptvSeries
import app.projektor.core.api.models.IptvSeriesDetail
import app.projektor.core.api.models.LiveCategory
import app.projektor.core.api.models.LiveChannel
import app.projektor.core.api.models.LiveDecideRequestInput
import app.projektor.core.api.models.LivePlaybackDecision
import app.projektor.core.api.models.LiveProgramme
import app.projektor.core.api.models.LiveStatus
import app.projektor.core.api.models.CreateRecordingRequestInput
import app.projektor.core.api.models.Recording
import app.projektor.core.api.models.RecordingStateInput
import app.projektor.core.bodyOrThrow

/** Live TV, catch-up, and provider VOD calls over the generated client. */
class LiveRepository(private val client: ProjektorClient) {
    suspend fun status(): LiveStatus = client.live.apiLiveStatusGet().bodyOrThrow()
    suspend fun categories(): List<LiveCategory> = client.live.apiLiveCategoriesGet().bodyOrThrow()
    suspend fun channels(category: String? = null): List<LiveChannel> = client.live.apiLiveChannelsGet(category).bodyOrThrow()
    suspend fun channel(id: String): LiveChannel = client.live.apiLiveChannelsIdGet(id).bodyOrThrow()
    suspend fun guide(channelId: String, fromIso: String? = null, toIso: String? = null): List<LiveProgramme> =
        client.live.apiLiveGuideGet(channelId, fromIso, toIso).bodyOrThrow()
    suspend fun decide(request: LiveDecideRequestInput): LivePlaybackDecision = client.live.apiLiveDecidePost(request).bodyOrThrow()
    /** Frees the server's ffmpeg for an HLS session; failures are ignored since the idle sweep catches them. */
    suspend fun releaseSession(id: String) { runCatching { client.live.apiLiveSessionsIdDelete(id) } }

    suspend fun movies(category: String? = null, search: String? = null, offset: Int = 0, limit: Int = 60): List<IptvMovie> =
        client.live.apiLiveVodGet(category, search, null, offset.toLong(), limit.toLong()).bodyOrThrow().items
    suspend fun series(category: String? = null, search: String? = null, offset: Int = 0, limit: Int = 60): List<IptvSeries> =
        client.live.apiLiveSeriesGet(category, search, null, offset.toLong(), limit.toLong()).bodyOrThrow().items
    suspend fun seriesDetail(id: String): IptvSeriesDetail = client.live.apiLiveSeriesIdGet(id).bodyOrThrow()

    suspend fun recordings(state: RecordingStateInput? = null): List<Recording> = client.recordings.apiRecordingsGet(state).bodyOrThrow()
    suspend fun recording(id: String): Recording = client.recordings.apiRecordingsIdGet(id).bodyOrThrow()
    suspend fun record(request: CreateRecordingRequestInput): Recording = client.recordings.apiRecordingsPost(request).bodyOrThrow()
    suspend fun stopRecording(id: String): Recording = client.recordings.apiRecordingsIdStopPost(id).bodyOrThrow()
    suspend fun deleteRecording(id: String) { client.recordings.apiRecordingsIdDelete(id) }
}
