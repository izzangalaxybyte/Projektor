package app.projektor.mobile.comics

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import app.projektor.core.comics.ComicsRepository
import app.projektor.core.comics.naturalCompare
import coil3.ImageLoader
import coil3.asImage
import coil3.decode.DataSource
import coil3.decode.ImageSource
import coil3.fetch.FetchResult
import coil3.fetch.Fetcher
import coil3.fetch.ImageFetchResult
import coil3.fetch.SourceFetchResult
import coil3.key.Keyer
import coil3.request.Options
import coil3.size.pxOrElse
import java.io.File
import java.util.zip.ZipFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okio.Buffer
import okio.FileSystem

/** Where the reader's pages come from; [model] is what Coil loads for a page. */
interface PageSource {
    val pageCount: Int
    /** The page at full quality, or at [thumbWidth] for thumbnails. */
    fun model(index: Int, thumbWidth: Int? = null): Any
    fun close() {}
}

/**
 * Pages from the server: archive pages are the original images, untouched; PDF pages are
 * rendered at [pdfWidth] (thumbnails always at their own width).
 */
class ServerPages(
    private val repo: ComicsRepository,
    private val bookId: String,
    override val pageCount: Int,
    private val isPdf: Boolean,
    private val pdfWidth: Int,
) : PageSource {
    override fun model(index: Int, thumbWidth: Int?): Any =
        repo.pageUrl(bookId, index, thumbWidth ?: if (isPdf) pdfWidth else null)
}

/** A page inside a downloaded CBZ. */
data class ZipPage(val file: File, val entry: String)

/** A page of a downloaded PDF, drawn on the phone. */
data class PdfPage(val file: File, val index: Int)

/** A downloaded CBZ: its images, in name order (the server numbered them 0001, 0002 ...). */
class CbzPages(private val file: File) : PageSource {
    private val entries: List<String> = ZipFile(file).use { zip ->
        zip.entries().asSequence().filter { !it.isDirectory && isImage(it.name) }.map { it.name }.toList().sortedWith(::naturalCompare)
    }
    override val pageCount: Int = entries.size
    override fun model(index: Int, thumbWidth: Int?): Any = ZipPage(file, entries[index])
    override fun close() = OpenZips.close(file)

    private fun isImage(name: String) = name.substringAfterLast('.', "").lowercase() in IMAGE_EXTENSIONS
}

/** A downloaded PDF, drawn with the phone's own PDF renderer. */
class PdfPages(private val file: File) : PageSource {
    override val pageCount: Int = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
        PdfRenderer(fd).use { it.pageCount }
    }
    override fun model(index: Int, thumbWidth: Int?): Any = PdfPage(file, index)
    override fun close() = OpenPdfs.close(file)
}

private val IMAGE_EXTENSIONS = setOf("jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "heic", "heif")

/** Open ZIP files, shared by the page fetches of one book; ZipFile reads are thread safe. */
private object OpenZips {
    private val open = mutableMapOf<String, ZipFile>()
    @Synchronized fun get(file: File): ZipFile = open.getOrPut(file.path) { ZipFile(file) }
    @Synchronized fun close(file: File) { open.remove(file.path)?.let { runCatching { it.close() } } }
}

/** One renderer per PDF; PdfRenderer draws one page at a time, so fetches take turns. */
private object OpenPdfs {
    private class Doc(val fd: ParcelFileDescriptor, val renderer: PdfRenderer, val lock: Mutex = Mutex())
    private val open = mutableMapOf<String, Doc>()

    @Synchronized private fun doc(file: File): Doc = open.getOrPut(file.path) {
        val fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        Doc(fd, PdfRenderer(fd))
    }

    suspend fun render(file: File, index: Int, width: Int): Bitmap {
        val d = doc(file)
        return d.lock.withLock {
            d.renderer.openPage(index).use { page ->
                val w = width.coerceIn(64, 4096)
                val h = (w.toFloat() * page.height / page.width).toInt().coerceAtLeast(1)
                Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also {
                    it.eraseColor(Color.WHITE)
                    page.render(it, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                }
            }
        }
    }

    @Synchronized fun close(file: File) {
        open.remove(file.path)?.let { runCatching { it.renderer.close(); it.fd.close() } }
    }
}

private class ZipPageFetcher(private val page: ZipPage, private val options: Options) : Fetcher {
    override suspend fun fetch(): FetchResult = withContext(Dispatchers.IO) {
        val zip = OpenZips.get(page.file)
        val entry = zip.getEntry(page.entry) ?: error("missing page ${page.entry}")
        val buffer = Buffer()
        zip.getInputStream(entry).use { buffer.readFrom(it) }
        SourceFetchResult(ImageSource(buffer, FileSystem.SYSTEM), null, DataSource.DISK)
    }

    class Factory : Fetcher.Factory<ZipPage> {
        override fun create(data: ZipPage, options: Options, imageLoader: ImageLoader): Fetcher = ZipPageFetcher(data, options)
    }
}

private class PdfPageFetcher(private val page: PdfPage, private val options: Options) : Fetcher {
    override suspend fun fetch(): FetchResult = withContext(Dispatchers.IO) {
        val width = options.size.width.pxOrElse { DEFAULT_PDF_WIDTH }
        ImageFetchResult(OpenPdfs.render(page.file, page.index, width).asImage(), isSampled = true, dataSource = DataSource.DISK)
    }

    class Factory : Fetcher.Factory<PdfPage> {
        override fun create(data: PdfPage, options: Options, imageLoader: ImageLoader): Fetcher = PdfPageFetcher(data, options)
    }
}

private const val DEFAULT_PDF_WIDTH = 1600

/** The image loader the reader uses: Coil's own network loading plus the offline pages above. */
fun comicImageLoader(context: Context): ImageLoader =
    ImageLoader.Builder(context)
        .components {
            add(ZipPageFetcher.Factory())
            add(PdfPageFetcher.Factory())
            add(Keyer<ZipPage> { data, _ -> "zip:${data.file.path}#${data.entry}" })
            add(Keyer<PdfPage> { data, options -> "pdf:${data.file.path}#${data.index}@${options.size.width.pxOrElse { DEFAULT_PDF_WIDTH }}" })
        }
        .build()
