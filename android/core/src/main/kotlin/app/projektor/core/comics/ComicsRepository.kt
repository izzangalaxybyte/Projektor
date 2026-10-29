package app.projektor.core.comics

import app.projektor.core.ProjektorClient
import app.projektor.core.api.models.ApiComicsSeriesIdReadPutRequest
import app.projektor.core.api.models.ComicBook
import app.projektor.core.api.models.ComicBookDetail
import app.projektor.core.api.models.ComicProgress
import app.projektor.core.api.models.ComicProgressUpdateInput
import app.projektor.core.api.models.ComicSeries
import app.projektor.core.api.models.ComicSeriesDetail
import app.projektor.core.bodyOrThrow
import app.projektor.core.okOrThrow

/** How the series grid is ordered. */
enum class SeriesSort(val value: String) { TITLE("title"), ADDED("added"), RECENT("recent") }

/** Comic and manga libraries over the generated client. */
class ComicsRepository(private val client: ProjektorClient) {
    suspend fun series(search: String? = null, sort: SeriesSort = SeriesSort.TITLE, libraryId: String? = null): List<ComicSeries> =
        client.comics.apiComicsSeriesGet(libraryId, search?.takeIf { it.isNotBlank() }, sort.value).bodyOrThrow()

    /** A series and its books in reading order. */
    suspend fun seriesDetail(id: String): ComicSeriesDetail = client.comics.apiComicsSeriesIdGet(id).bodyOrThrow()

    suspend fun book(id: String): ComicBookDetail = client.comics.apiComicsBooksIdGet(id).bodyOrThrow()

    /** Saves the page being read; [at] (ISO time) when it was read offline and is sent late. */
    suspend fun setPage(bookId: String, page: Int, at: String? = null): ComicProgress =
        client.comics.apiComicsBooksIdProgressPut(bookId, ComicProgressUpdateInput(page = page.toLong(), at = at)).bodyOrThrow()

    suspend fun setRead(bookId: String, read: Boolean) {
        // Unread answers a bare `null`, which the generated model cannot parse.
        client.comics.apiComicsBooksIdReadPut(bookId, ApiComicsSeriesIdReadPutRequest(read)).okOrThrow()
    }

    suspend fun setSeriesRead(seriesId: String, read: Boolean) {
        client.comics.apiComicsSeriesIdReadPut(seriesId, ApiComicsSeriesIdReadPutRequest(read)).okOrThrow()
    }

    suspend fun continueReading(limit: Int = 20): List<ComicBook> = client.comics.apiComicsContinueGet(limit.toLong()).bodyOrThrow()

    suspend fun history(offset: Int = 0, limit: Int = 50): List<ComicBook> =
        client.comics.apiComicsHistoryGet(offset.toLong(), limit.toLong()).bodyOrThrow()

    /**
     * A page image the reader loads itself. Without [width] archive pages are the original files;
     * PDFs are always rendered, at [width] when given.
     */
    fun pageUrl(bookId: String, page: Int, width: Int? = null): String =
        client.withAccessToken("/api/comics/books/$bookId/pages/$page" + (width?.let { "?w=$it" } ?: ""))

    /** The book to keep on the phone: an ordered CBZ of the original pages, or the PDF. */
    fun fileUrl(bookId: String): String = client.withAccessToken("/api/comics/books/$bookId/file")

    fun coverUrl(key: String?, width: Int = 300): String? = client.imageUrl(key, width)
}
