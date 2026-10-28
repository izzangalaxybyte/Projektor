package app.projektor.mobile.ui.comics

import android.app.Activity
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.projektor.core.api.models.ComicProgress
import app.projektor.core.comics.PageDirection
import app.projektor.core.comics.Spread
import app.projektor.core.comics.TapAction
import app.projektor.core.comics.indexOfPage
import app.projektor.core.comics.isWidePage
import app.projektor.core.comics.spreads
import app.projektor.core.comics.tapAction
import app.projektor.mobile.AppContainer
import app.projektor.mobile.comics.CbzPages
import app.projektor.mobile.comics.FitMode
import app.projektor.mobile.comics.PageMode
import app.projektor.mobile.comics.PageSource
import app.projektor.mobile.comics.PdfPages
import app.projektor.mobile.comics.ReadMode
import app.projektor.mobile.comics.ReaderSettings
import app.projektor.mobile.comics.ScreenOrientation
import app.projektor.mobile.comics.ServerPages
import app.projektor.mobile.ui.userMessage
import coil3.ImageLoader
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.size.Dimension
import coil3.size.Precision
import coil3.size.Size
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import me.saket.telephoto.zoomable.DoubleClickToZoomListener
import me.saket.telephoto.zoomable.EnabledZoomGestures
import me.saket.telephoto.zoomable.ZoomSpec
import me.saket.telephoto.zoomable.rememberZoomableState
import me.saket.telephoto.zoomable.zoomable

/** What the reader needs to know about a book, online or from a download. */
private data class ReaderBook(
    val id: String,
    val seriesId: String,
    val seriesTitle: String,
    val label: String?,
    val title: String,
    val rightToLeft: Boolean,
    val previousId: String?,
    val nextId: String?,
    val source: PageSource,
    val startPage: Int,
    val offline: Boolean,
)

/**
 * The comic reader, CDisplayEx style. Pages come from a download when there is one, else from
 * the server as the original images. [startPage] overrides where the book was left off.
 */
@Composable
fun ComicReaderScreen(container: AppContainer, bookId: String, startPage: Int?, openBook: (String) -> Unit, back: () -> Unit) {
    val repo = container.comics()
    val configuration = LocalConfiguration.current
    val density = androidx.compose.ui.platform.LocalDensity.current
    val longSide = with(density) { maxOf(configuration.screenWidthDp, configuration.screenHeightDp).dp.roundToPx() }
    var book by remember(bookId) { mutableStateOf<ReaderBook?>(null) }
    var error by remember(bookId) { mutableStateOf<String?>(null) }

    LaunchedEffect(bookId) {
        try {
            book = withContext(Dispatchers.IO) { loadBook(container, bookId, startPage, (longSide * 1.25f).toInt().coerceAtMost(3000)) }
        } catch (e: Exception) { error = e.userMessage() }
    }
    DisposableEffect(book) { onDispose { book?.source?.close() } }

    val b = book
    when {
        error != null -> Box(Modifier.fillMaxSize().background(Color.Black).windowInsetsPadding(WindowInsets.safeDrawing).padding(16.dp)) {
            IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Color.White) }
            Text(error!!, Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.error)
        }
        b == null -> Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        else -> Reader(container, b, repo != null, openBook, back)
    }
}

private suspend fun loadBook(container: AppContainer, bookId: String, startPage: Int?, pdfWidth: Int): ReaderBook {
    val repo = container.comics()
    val local = container.comicDownloads.readable(bookId)
    val online = repo?.let { runCatching { it.book(bookId) }.getOrNull() }
    if (online == null && local == null) error("Can't reach the server, and this book isn't downloaded.")
    repo?.let { container.comicProgress.flush(it) }
    val source: PageSource = when {
        local != null && local.isPdf -> PdfPages(container.comicDownloads.fileOf(local))
        local != null -> CbzPages(container.comicDownloads.fileOf(local))
        else -> ServerPages(repo!!, bookId, (online!!.pageCount ?: 0L).toInt(), online.format?.value == "pdf", pdfWidth)
    }
    if (source.pageCount == 0) error("This book has no pages.")
    // The newer of the server's progress and this phone's; a finished book starts over.
    val server = online?.progress ?: local?.book?.progress
    val mine = container.comicProgress.get(bookId)
    val resume = when {
        mine != null && (server == null || mine.at > server.updatedAt) -> if (mine.page >= mine.pageCount - 1) 0 else mine.page
        server != null -> if (server.finished) 0 else server.page.toInt()
        else -> 0
    }
    val seriesId = online?.seriesId ?: local!!.book.seriesId
    // Offline, next and previous are the neighbouring downloads of the series.
    val siblings = if (online == null) container.comicDownloads.ofSeries(seriesId) else emptyList()
    val at = siblings.indexOfFirst { it.bookId == bookId }
    return ReaderBook(
        id = bookId,
        seriesId = seriesId,
        seriesTitle = online?.seriesTitle ?: local!!.book.seriesTitle,
        label = online?.label ?: local?.book?.label,
        title = online?.title ?: local!!.book.title,
        rightToLeft = (online?.direction ?: local?.book?.direction)?.value == "rtl",
        previousId = online?.previousId ?: siblings.getOrNull(at - 1)?.bookId,
        nextId = online?.nextId ?: siblings.getOrNull(at + 1)?.bookId?.takeIf { at >= 0 },
        source = source,
        startPage = (startPage ?: resume).coerceIn(0, source.pageCount - 1),
        offline = local != null,
    )
}

private enum class Panel { NONE, SETTINGS, PAGES }

@Composable
private fun Reader(container: AppContainer, book: ReaderBook, online: Boolean, openBook: (String) -> Unit, back: () -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var settings by remember(book.seriesId) { mutableStateOf(container.readerPrefs.get(book.seriesId)) }
    fun update(s: ReaderSettings) { settings = s; container.readerPrefs.set(book.seriesId, s) }
    val mode = settings.readMode ?: if (book.rightToLeft) ReadMode.RTL else ReadMode.LTR
    val direction = if (mode == ReadMode.RTL) PageDirection.RTL else PageDirection.LTR
    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
    val double = mode != ReadMode.WEBTOON && settings.double(landscape)
    val pageCount = book.source.pageCount

    var page by rememberSaveable(book.id) { mutableIntStateOf(book.startPage) }
    var atEnd by remember(book.id) { mutableStateOf(false) }
    var wide by remember(book.id) { mutableStateOf(emptySet<Int>()) }
    var ui by remember { mutableStateOf(true) }
    var panel by remember { mutableStateOf(Panel.NONE) }
    var screen by remember { mutableStateOf(IntSize(1080, 1920)) }
    val colorFilter = remember(settings) { settings.colorFilter() }
    val layout = remember(pageCount, double, settings.coverAlone, settings.shiftSpreads, wide) {
        spreads(pageCount, double, settings.coverAlone != settings.shiftSpreads, wide)
    }
    val loader = container.comicImages
    val repo = container.comics()

    // Controls show at first, then get out of the way.
    LaunchedEffect(Unit) { delay(2500); if (panel == Panel.NONE) ui = false }
    ReaderWindow(settings.orientation)

    // Save the page: a moment after it settles, and when the reader closes.
    val reportPage = if (atEnd) pageCount - 1 else if (mode == ReadMode.WEBTOON) page else layout.getOrNull(layout.indexOfPage(page))?.last ?: page
    val lastReport by rememberUpdatedState(reportPage)
    LaunchedEffect(reportPage) {
        delay(700)
        container.comicProgress.save(repo, book.id, reportPage, pageCount)
    }
    DisposableEffect(book.id) { onDispose { container.comicProgress.save(repo, book.id, lastReport, pageCount) } }

    // Load the next few pages ahead of time.
    LaunchedEffect(page, settings.fit) {
        for (i in page + 1..minOf(page + 4, pageCount - 1)) loader.enqueue(pageRequest(context, book.source.model(i), settings.fit, screen))
    }

    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    // Paged reading: one pager page per spread, plus a last page for the end of the book.
    val pager = rememberPagerState(initialPage = layout.indexOfPage(book.startPage)) { layout.size + 1 }
    // Gesture handlers outlive a recomposition; they read these, never a stale copy.
    val currentLayout by rememberUpdatedState(layout)
    val currentMode by rememberUpdatedState(mode)
    LaunchedEffect(pager) {
        snapshotFlow { pager.currentPage }.collect { i ->
            atEnd = i >= currentLayout.size
            currentLayout.getOrNull(i)?.let { page = it.first }
        }
    }
    // When the pairing or the mode changes (a wide page found, two-page mode or scrolling toggled)
    // stay on the same page.
    val list = rememberLazyListState(initialFirstVisibleItemIndex = book.startPage)
    LaunchedEffect(layout, mode) {
        if (mode == ReadMode.WEBTOON) {
            if (list.firstVisibleItemIndex != page) list.scrollToItem(page)
        } else if (!atEnd) {
            val target = layout.indexOfPage(page)
            if (pager.currentPage != target) pager.scrollToPage(target)
        }
    }
    LaunchedEffect(list) {
        snapshotFlow { list.firstVisibleItemIndex to list.layoutInfo.totalItemsCount }.collect { (first, total) ->
            if (currentMode == ReadMode.WEBTOON) {
                atEnd = total > 0 && list.layoutInfo.visibleItemsInfo.any { it.index == pageCount }
                page = first.coerceAtMost(pageCount - 1)
            }
        }
    }

    fun turn(delta: Int) {
        scope.launch {
            if (currentMode == ReadMode.WEBTOON) {
                list.animateScrollBy(delta * screen.height * 0.85f)
                return@launch
            }
            if (delta > 0 && atEnd) {
                book.nextId?.let(openBook)
                return@launch
            }
            val target = (pager.currentPage + delta).coerceIn(0, currentLayout.size)
            if (settings.animatePageTurns) pager.animateScrollToPage(target) else pager.scrollToPage(target)
        }
    }
    fun jump(to: Int) {
        scope.launch {
            if (currentMode == ReadMode.WEBTOON) list.scrollToItem(to) else pager.scrollToPage(currentLayout.indexOfPage(to))
        }
    }
    fun tap(offset: Offset, width: Float) {
        val action = if (settings.tapZones) tapAction(offset.x, width, direction) else TapAction.MENU
        when (action) {
            TapAction.NEXT -> turn(1)
            TapAction.PREVIOUS -> turn(-1)
            TapAction.MENU -> ui = !ui
        }
    }

    BackHandler {
        when {
            panel != Panel.NONE -> panel = Panel.NONE
            else -> back()
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(settings.background.argb))
            .onSizeChanged { screen = it }
            .focusRequester(focus)
            .focusable()
            .onPreviewKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                val forward = if (direction == PageDirection.RTL) Key.DirectionLeft else Key.DirectionRight
                val backward = if (direction == PageDirection.RTL) Key.DirectionRight else Key.DirectionLeft
                when (e.key) {
                    Key.VolumeDown -> settings.volumeKeys.also { if (it) turn(1) }
                    Key.VolumeUp -> settings.volumeKeys.also { if (it) turn(-1) }
                    forward, Key.PageDown, Key.Spacebar, Key.DirectionDown -> { turn(1); true }
                    backward, Key.PageUp, Key.DirectionUp -> { turn(-1); true }
                    else -> false
                }
            }
            .testTag("comic-reader"),
    ) {
        if (mode == ReadMode.WEBTOON) {
            WebtoonPages(book, list, loader, settings, colorFilter, screen, ::tap, openBook, back)
        } else {
            HorizontalPager(
                state = pager,
                reverseLayout = direction == PageDirection.RTL,
                beyondViewportPageCount = 1,
                key = { it },
                modifier = Modifier.fillMaxSize().testTag("comic-pager"),
            ) { i ->
                val spread = layout.getOrNull(i)
                if (spread == null) {
                    EndOfBook(book, container, openBook, back)
                } else {
                    SpreadPage(
                        spread = spread,
                        direction = direction,
                        source = book.source,
                        loader = loader,
                        settings = settings,
                        colorFilter = colorFilter,
                        screen = screen,
                        onTap = ::tap,
                        onSize = { p, w, h -> if (isWidePage(w, h) && p !in wide) wide = wide + p },
                    )
                }
            }
        }
        // Dimmer below the phone's own brightness; touches pass through to the pages.
        if (settings.brightness < 1f) Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = (1f - settings.brightness).coerceIn(0f, 0.85f))))

        if (ui) {
            TopBar(book, onBack = back, onPages = { panel = Panel.PAGES }, onSettings = { panel = Panel.SETTINGS }, modifier = Modifier.align(Alignment.TopCenter))
            BottomBar(
                book = book,
                page = page,
                spreadPages = if (mode == ReadMode.WEBTOON) listOf(page) else layout.getOrNull(layout.indexOfPage(page))?.pages ?: listOf(page),
                rtl = direction == PageDirection.RTL,
                settings = settings,
                mode = mode,
                loader = loader,
                onJump = ::jump,
                onSettings = ::update,
                onCurrentMode = { m -> update(settings.copy(readMode = m)) },
                openBook = openBook,
                modifier = Modifier.align(Alignment.BottomCenter),
            )
        }
        when (panel) {
            Panel.SETTINGS -> SettingsPanel(settings, book.rightToLeft, ::update, onClose = { panel = Panel.NONE })
            Panel.PAGES -> PagesPanel(book, loader, page, direction == PageDirection.RTL, onPick = { jump(it); panel = Panel.NONE }, onClose = { panel = Panel.NONE })
            Panel.NONE -> Unit
        }
    }
}

/** Landscape or portrait as chosen, edge to edge, bars hidden, screen kept on. */
@Composable
private fun ReaderWindow(orientation: ScreenOrientation) {
    val context = LocalContext.current
    val view = LocalView.current
    DisposableEffect(orientation) {
        val activity = context as? Activity
        val before = activity?.requestedOrientation
        activity?.requestedOrientation = when (orientation) {
            ScreenOrientation.AUTO -> ActivityInfo.SCREEN_ORIENTATION_FULL_USER
            ScreenOrientation.PORTRAIT -> ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT
            ScreenOrientation.LANDSCAPE -> ActivityInfo.SCREEN_ORIENTATION_USER_LANDSCAPE
        }
        val window = activity?.window
        val controller = window?.let { WindowInsetsControllerCompat(it, view) }
        controller?.hide(WindowInsetsCompat.Type.systemBars())
        controller?.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        window?.let { WindowCompat.setDecorFitsSystemWindows(it, false) }
        view.keepScreenOn = true
        onDispose {
            view.keepScreenOn = false
            controller?.show(WindowInsetsCompat.Type.systemBars())
            if (activity != null && before != null) activity.requestedOrientation = before
        }
    }
}

/** Loads a page as sharp as the fit needs: up to twice the screen, or every pixel for 1:1. */
private fun pageRequest(context: android.content.Context, model: Any, fit: FitMode, screen: IntSize): ImageRequest =
    ImageRequest.Builder(context)
        .data(model)
        .apply {
            when (fit) {
                FitMode.ORIGINAL -> size(Size.ORIGINAL)
                FitMode.WIDTH -> size(Dimension.Pixels(screen.width * 2), Dimension.Undefined)
                FitMode.HEIGHT -> size(Dimension.Undefined, Dimension.Pixels(screen.height * 2))
                FitMode.SCREEN -> size(screen.width * 2, screen.height * 2)
            }
        }
        .precision(Precision.INEXACT)
        .build()

@Composable
private fun PageImage(
    source: PageSource,
    page: Int,
    loader: ImageLoader,
    settings: ReaderSettings,
    colorFilter: ColorFilter?,
    screen: IntSize,
    contentScale: ContentScale,
    alignment: Alignment,
    modifier: Modifier,
    onSize: (page: Int, width: Int, height: Int) -> Unit,
) {
    val context = LocalContext.current
    val request = remember(page, source, settings.fit, screen) { pageRequest(context, source.model(page), settings.fit, screen) }
    AsyncImage(
        model = request,
        contentDescription = "Page ${page + 1}",
        imageLoader = loader,
        modifier = modifier,
        contentScale = contentScale,
        alignment = alignment,
        colorFilter = colorFilter,
        filterQuality = FilterQuality.High,
        onSuccess = { s -> onSize(page, s.result.image.width, s.result.image.height) },
    )
}

/** One spread, laid out by the fit: zoomable to the screen, or scrolled at width, height or 1:1. */
@Composable
private fun SpreadPage(
    spread: Spread,
    direction: PageDirection,
    source: PageSource,
    loader: ImageLoader,
    settings: ReaderSettings,
    colorFilter: ColorFilter?,
    screen: IntSize,
    onTap: (Offset, Float) -> Unit,
    onSize: (page: Int, width: Int, height: Int) -> Unit,
) {
    val pages = spread.onScreen(direction)
    var width by remember { mutableFloatStateOf(1f) }
    val currentOnTap by rememberUpdatedState(onTap)
    // The pages of a spread meet at the gutter: the left one hugs its right edge and vice versa.
    fun align(k: Int, vertical: Alignment.Vertical): Alignment = when {
        pages.size == 1 -> if (vertical == Alignment.Top) Alignment.TopCenter else Alignment.Center
        k == 0 -> if (vertical == Alignment.Top) Alignment.TopEnd else Alignment.CenterEnd
        else -> if (vertical == Alignment.Top) Alignment.TopStart else Alignment.CenterStart
    }
    val tapModifier = Modifier.pointerInput(Unit) { detectTapGestures { currentOnTap(it, size.width.toFloat()) } }
    when (settings.fit) {
        FitMode.SCREEN -> {
            val zoom = rememberZoomableState(zoomSpec = ZoomSpec(maxZoomFactor = 6f))
            Box(
                Modifier
                    .fillMaxSize()
                    .onSizeChanged { width = it.width.toFloat() }
                    .zoomable(
                        state = zoom,
                        gestures = EnabledZoomGestures.ZoomAndPan,
                        onClick = { onTap(it, width) },
                        onDoubleClick = DoubleClickToZoomListener.cycle(maxZoomFactor = 2.5f),
                    ),
            ) {
                Row(Modifier.fillMaxSize()) {
                    pages.forEachIndexed { k, p ->
                        PageImage(source, p, loader, settings, colorFilter, screen, ContentScale.Fit, align(k, Alignment.CenterVertically), Modifier.weight(1f).fillMaxHeight(), onSize)
                    }
                }
            }
        }
        FitMode.WIDTH -> Box(Modifier.fillMaxSize().then(tapModifier).verticalScroll(rememberScrollState())) {
            Row(Modifier.fillMaxWidth()) {
                pages.forEachIndexed { k, p ->
                    PageImage(source, p, loader, settings, colorFilter, screen, ContentScale.FillWidth, align(k, Alignment.Top), Modifier.weight(1f), onSize)
                }
            }
        }
        FitMode.HEIGHT -> Box(Modifier.fillMaxSize().then(tapModifier).horizontalScroll(rememberScrollState()), contentAlignment = Alignment.Center) {
            Row(Modifier.fillMaxHeight()) {
                pages.forEach { p -> PageImage(source, p, loader, settings, colorFilter, screen, ContentScale.FillHeight, Alignment.Center, Modifier.fillMaxHeight(), onSize) }
            }
        }
        FitMode.ORIGINAL -> Box(Modifier.fillMaxSize().then(tapModifier).verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState())) {
            Row {
                pages.forEach { p -> PageImage(source, p, loader, settings, colorFilter, screen, ContentScale.None, Alignment.TopStart, Modifier, onSize) }
            }
        }
    }
}

/** Webtoon mode: every page down one long strip, full width, no gaps. */
@Composable
private fun WebtoonPages(
    book: ReaderBook,
    list: androidx.compose.foundation.lazy.LazyListState,
    loader: ImageLoader,
    settings: ReaderSettings,
    colorFilter: ColorFilter?,
    screen: IntSize,
    onTap: (Offset, Float) -> Unit,
    openBook: (String) -> Unit,
    back: () -> Unit,
) {
    val ratios = remember(book.id) { mutableStateMapOf<Int, Float>() }
    val currentOnTap by rememberUpdatedState(onTap)
    val webtoon = settings.copy(fit = FitMode.WIDTH)
    LazyColumn(
        state = list,
        modifier = Modifier.fillMaxSize().pointerInput(Unit) {
            // Top and bottom thirds scroll a screen; the middle shows the controls.
            detectTapGestures { o -> currentOnTap(Offset(if (o.y < size.height * 0.3f) 0f else if (o.y > size.height * 0.7f) size.width.toFloat() else size.width / 2f, o.y), size.width.toFloat()) }
        },
    ) {
        items(book.source.pageCount, key = { it }) { p ->
            PageImage(
                book.source, p, loader, webtoon, colorFilter, screen, ContentScale.FillWidth, Alignment.TopCenter,
                Modifier.fillMaxWidth().aspectRatio(ratios[p] ?: 0.7f),
                onSize = { i, w, h -> if (h > 0) ratios[i] = w.toFloat() / h },
            )
        }
        item(key = "end") { Box(Modifier.fillMaxWidth().height(480.dp)) { EndOfBookContent(book, openBook, back) } }
    }
}

/** After the last page: what was finished and what comes next. */
@Composable
private fun EndOfBook(book: ReaderBook, container: AppContainer, openBook: (String) -> Unit, back: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.85f))) { EndOfBookContent(book, openBook, back) }
}

@Composable
private fun EndOfBookContent(book: ReaderBook, openBook: (String) -> Unit, back: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp).testTag("comic-end"), verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Finished", style = MaterialTheme.typography.labelLarge, color = Color.White.copy(alpha = 0.7f))
        Text(listOfNotNull(book.seriesTitle, book.label ?: book.title).joinToString(" · "), style = MaterialTheme.typography.titleLarge, color = Color.White)
        if (book.nextId != null) {
            Button(onClick = { openBook(book.nextId) }, modifier = Modifier.widthIn(min = 220.dp).testTag("comic-next-book")) {
                Icon(Icons.Filled.SkipNext, null)
                Text(" Next book")
            }
        } else {
            Text(if (book.offline) "That's the last downloaded book of this series." else "That's the last book of this series.", color = Color.White.copy(alpha = 0.8f))
        }
        OutlinedButton(onClick = back) { Text("Close", color = Color.White) }
    }
}

@Composable
private fun TopBar(book: ReaderBook, onBack: () -> Unit, onPages: () -> Unit, onSettings: () -> Unit, modifier: Modifier) {
    Row(
        modifier.fillMaxWidth().swallowTaps().background(Color.Black.copy(alpha = 0.7f)).windowInsetsPadding(WindowInsets.safeDrawing).padding(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack, modifier = Modifier.testTag("back")) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Color.White) }
        Column(Modifier.weight(1f)) {
            Text(book.seriesTitle, style = MaterialTheme.typography.titleMedium, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(book.label, book.title.takeIf { book.label == null || it != book.label }, "Downloaded".takeIf { book.offline }).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = Color.White.copy(alpha = 0.7f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        IconButton(onClick = onPages, modifier = Modifier.testTag("comic-pages")) { Icon(Icons.Filled.GridView, "All pages", tint = Color.White) }
        IconButton(onClick = onSettings, modifier = Modifier.testTag("comic-settings")) { Icon(Icons.Filled.Tune, "Reader settings", tint = Color.White) }
    }
}

@Composable
private fun BottomBar(
    book: ReaderBook,
    page: Int,
    spreadPages: List<Int>,
    rtl: Boolean,
    settings: ReaderSettings,
    mode: ReadMode,
    loader: ImageLoader,
    onJump: (Int) -> Unit,
    onSettings: (ReaderSettings) -> Unit,
    onCurrentMode: (ReadMode) -> Unit,
    openBook: (String) -> Unit,
    modifier: Modifier,
) {
    val count = book.source.pageCount
    var dragging by remember { mutableStateOf<Float?>(null) }
    Column(modifier.fillMaxWidth().swallowTaps().background(Color.Black.copy(alpha = 0.7f)).windowInsetsPadding(WindowInsets.navigationBars).padding(horizontal = 8.dp, vertical = 6.dp)) {
        if (settings.showThumbnailStrip) ThumbnailStrip(book, loader, page, rtl, onJump)
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { book.previousId?.let(openBook) }, enabled = book.previousId != null) {
                Icon(Icons.Filled.SkipPrevious, "Previous book", tint = if (book.previousId != null) Color.White else Color.White.copy(alpha = 0.3f))
            }
            // A manga's slider runs right to left, like its pages.
            CompositionLocalProvider(LocalLayoutDirection provides if (rtl) LayoutDirection.Rtl else LayoutDirection.Ltr) {
                Slider(
                    value = dragging ?: page.toFloat(),
                    onValueChange = { dragging = it },
                    onValueChangeFinished = { dragging?.let { onJump(it.toInt()) }; dragging = null },
                    valueRange = 0f..(count - 1).coerceAtLeast(1).toFloat(),
                    modifier = Modifier.weight(1f).testTag("comic-slider"),
                )
            }
            IconButton(onClick = { book.nextId?.let(openBook) }, enabled = book.nextId != null) {
                Icon(Icons.Filled.SkipNext, "Next book", tint = if (book.nextId != null) Color.White else Color.White.copy(alpha = 0.3f))
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val shown = dragging?.toInt()?.let { listOf(it) } ?: spreadPages
            Text(
                "${shown.map { it + 1 }.sorted().joinToString("–")} / $count",
                style = MaterialTheme.typography.labelLarge,
                color = Color.White,
                modifier = Modifier.padding(horizontal = 8.dp).testTag("comic-page-label"),
            )
            Spacer(Modifier.weight(1f))
            // Quick switches, each cycling through its options.
            AssistChip(
                onClick = { onCurrentMode(ReadMode.entries[(mode.ordinal + 1) % ReadMode.entries.size]) },
                label = { Text(when (mode) { ReadMode.LTR -> "L → R"; ReadMode.RTL -> "R ← L"; ReadMode.WEBTOON -> "Scroll" }, color = Color.White) },
                modifier = Modifier.testTag("comic-direction"),
            )
            if (mode != ReadMode.WEBTOON) {
                AssistChip(
                    onClick = { onSettings(settings.copy(pageMode = PageMode.entries[(settings.pageMode.ordinal + 1) % PageMode.entries.size])) },
                    label = { Text(when (settings.pageMode) { PageMode.SINGLE -> "1 page"; PageMode.DOUBLE -> "2 pages"; PageMode.AUTO -> "Auto pages" }, color = Color.White) },
                    modifier = Modifier.testTag("comic-page-mode"),
                )
                AssistChip(
                    onClick = { onSettings(settings.copy(fit = FitMode.entries[(settings.fit.ordinal + 1) % FitMode.entries.size])) },
                    label = { Text(when (settings.fit) { FitMode.SCREEN -> "Fit screen"; FitMode.WIDTH -> "Fit width"; FitMode.HEIGHT -> "Fit height"; FitMode.ORIGINAL -> "1:1" }, color = Color.White) },
                    modifier = Modifier.testTag("comic-fit"),
                )
            }
        }
    }
}

@Composable
private fun ThumbnailStrip(book: ReaderBook, loader: ImageLoader, page: Int, rtl: Boolean, onJump: (Int) -> Unit) {
    val state = rememberLazyListState()
    LaunchedEffect(page) { state.scrollToItem((page - 3).coerceAtLeast(0)) }
    LazyRow(state = state, reverseLayout = rtl, horizontalArrangement = Arrangement.spacedBy(6.dp), contentPadding = PaddingValues(horizontal = 4.dp), modifier = Modifier.fillMaxWidth().height(92.dp).testTag("comic-strip")) {
        items(book.source.pageCount) { p ->
            Thumbnail(book.source, loader, p, current = p == page, Modifier.width(56.dp)) { onJump(p) }
        }
    }
}

@Composable
private fun Thumbnail(source: PageSource, loader: ImageLoader, p: Int, current: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(modifier.clickable(onClick = onClick), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(6.dp))
                .border(if (current) 2.dp else 0.dp, if (current) MaterialTheme.colorScheme.primary else Color.Transparent, RoundedCornerShape(6.dp))
                .background(Color.White.copy(alpha = 0.08f)),
        ) {
            AsyncImage(model = source.model(p, thumbWidth = 240), contentDescription = null, imageLoader = loader, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        }
        Text("${p + 1}", style = MaterialTheme.typography.labelSmall, color = if (current) MaterialTheme.colorScheme.primary else Color.White.copy(alpha = 0.8f))
    }
}

/** Every page at once, to jump anywhere in the book. */
@Composable
private fun PagesPanel(book: ReaderBook, loader: ImageLoader, page: Int, rtl: Boolean, onPick: (Int) -> Unit, onClose: () -> Unit) {
    Column(Modifier.fillMaxSize().swallowTaps().background(Color.Black.copy(alpha = 0.95f)).windowInsetsPadding(WindowInsets.safeDrawing).testTag("comic-pages-panel")) {
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Pages", style = MaterialTheme.typography.titleLarge, color = Color.White, modifier = Modifier.weight(1f).padding(start = 8.dp))
            IconButton(onClick = onClose) { Icon(Icons.Filled.Close, "Close", tint = Color.White) }
        }
        CompositionLocalProvider(LocalLayoutDirection provides if (rtl) LayoutDirection.Rtl else LayoutDirection.Ltr) {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(96.dp),
                contentPadding = PaddingValues(12.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                state = androidx.compose.foundation.lazy.grid.rememberLazyGridState(initialFirstVisibleItemIndex = (page - 6).coerceAtLeast(0)),
            ) {
                items(book.source.pageCount) { p -> Thumbnail(book.source, loader, p, current = p == page, Modifier) { onPick(p) } }
            }
        }
    }
}

/** Taps on an overlay's empty parts stop there instead of turning the page underneath. */
private fun Modifier.swallowTaps(): Modifier = pointerInput(Unit) { detectTapGestures { } }
