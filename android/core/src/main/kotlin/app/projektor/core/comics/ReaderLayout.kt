package app.projektor.core.comics

/** Left to right (comics) or right to left (manga). */
enum class PageDirection { LTR, RTL }

/**
 * One screen of a paged reader: one page, or two side by side. [pages] are in reading order, so
 * the first is read first; [onScreen] is how they sit left to right.
 */
data class Spread(val pages: List<Int>) {
    val first: Int get() = pages.first()
    val last: Int get() = pages.last()
    fun onScreen(direction: PageDirection): List<Int> = if (direction == PageDirection.RTL) pages.reversed() else pages
}

/**
 * Pairs pages into two-page spreads the way CDisplayEx does:
 * - [firstAlone]: the cover stands alone, so page 2 and 3 face each other as printed.
 * - [wide] pages (already a double spread in the scan) always stand alone, and the pairing
 *   restarts after them.
 * - The last page stands alone when nothing is left to pair it with.
 * With [double] off every page stands alone.
 */
fun spreads(pageCount: Int, double: Boolean, firstAlone: Boolean, wide: Set<Int> = emptySet()): List<Spread> {
    if (pageCount <= 0) return emptyList()
    if (!double) return List(pageCount) { Spread(listOf(it)) }
    val out = mutableListOf<Spread>()
    var i = 0
    while (i < pageCount) {
        val alone = i in wide || (i == 0 && firstAlone) || i + 1 >= pageCount || (i + 1) in wide
        if (alone) {
            out += Spread(listOf(i))
            i += 1
        } else {
            out += Spread(listOf(i, i + 1))
            i += 2
        }
    }
    return out
}

/** The spread showing [page]; the last one when the page is past the end. */
fun List<Spread>.indexOfPage(page: Int): Int {
    if (isEmpty()) return 0
    val at = indexOfFirst { page in it.pages }
    return if (at >= 0) at else if (page < 0) 0 else lastIndex
}

/** Where a tap on the screen goes. */
enum class TapAction { PREVIOUS, NEXT, MENU }

/**
 * Tap zones: the outer thirds turn pages, the middle shows the controls. In right-to-left books
 * the left side moves forward, as turning a manga's page does.
 */
fun tapAction(x: Float, width: Float, direction: PageDirection): TapAction {
    if (width <= 0f) return TapAction.MENU
    val f = x / width
    return when {
        f < 0.3f -> if (direction == PageDirection.RTL) TapAction.NEXT else TapAction.PREVIOUS
        f > 0.7f -> if (direction == PageDirection.RTL) TapAction.PREVIOUS else TapAction.NEXT
        else -> TapAction.MENU
    }
}

/** Whether a page is a double-page scan: clearly wider than it is tall. */
fun isWidePage(width: Int, height: Int): Boolean = height > 0 && width.toFloat() / height > 1.15f
