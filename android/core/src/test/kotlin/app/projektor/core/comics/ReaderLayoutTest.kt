package app.projektor.core.comics

import org.junit.Assert.assertEquals
import org.junit.Test

class ReaderLayoutTest {
    private fun layout(count: Int, double: Boolean = true, firstAlone: Boolean = true, wide: Set<Int> = emptySet()) =
        spreads(count, double, firstAlone, wide).map { it.pages }

    @Test
    fun `single page mode shows every page alone`() {
        assertEquals(listOf(listOf(0), listOf(1), listOf(2)), layout(3, double = false))
    }

    @Test
    fun `double pages keep the cover alone so printed spreads face each other`() {
        assertEquals(listOf(listOf(0), listOf(1, 2), listOf(3, 4), listOf(5)), layout(6))
        assertEquals(listOf(listOf(0, 1), listOf(2, 3), listOf(4, 5)), layout(6, firstAlone = false))
    }

    @Test
    fun `wide scans stand alone and pairing restarts after them`() {
        assertEquals(listOf(listOf(0), listOf(1, 2), listOf(3), listOf(4, 5), listOf(6)), layout(7, wide = setOf(3)))
        // A wide page right after a single one leaves that one alone too.
        assertEquals(listOf(listOf(0), listOf(1), listOf(2), listOf(3, 4)), layout(5, wide = setOf(2)))
    }

    @Test
    fun `right to left puts the first page on the right`() {
        val spread = Spread(listOf(1, 2))
        assertEquals(listOf(1, 2), spread.onScreen(PageDirection.LTR))
        assertEquals(listOf(2, 1), spread.onScreen(PageDirection.RTL))
    }

    @Test
    fun `finds the spread showing a page`() {
        val s = spreads(6, double = true, firstAlone = true)
        assertEquals(0, s.indexOfPage(0))
        assertEquals(1, s.indexOfPage(2))
        assertEquals(3, s.indexOfPage(5))
        assertEquals(3, s.indexOfPage(99))
        assertEquals(0, s.indexOfPage(-1))
    }

    @Test
    fun `tap zones follow the reading direction`() {
        assertEquals(TapAction.PREVIOUS, tapAction(10f, 1000f, PageDirection.LTR))
        assertEquals(TapAction.NEXT, tapAction(990f, 1000f, PageDirection.LTR))
        assertEquals(TapAction.NEXT, tapAction(10f, 1000f, PageDirection.RTL))
        assertEquals(TapAction.PREVIOUS, tapAction(990f, 1000f, PageDirection.RTL))
        assertEquals(TapAction.MENU, tapAction(500f, 1000f, PageDirection.RTL))
    }

    @Test
    fun `wide pages are clearly landscape`() {
        assertEquals(true, isWidePage(2000, 1400))
        assertEquals(false, isWidePage(1400, 2000))
        assertEquals(false, isWidePage(1000, 950))
    }

    @Test
    fun `book order reads volumes, then chapters, then extras`() {
        fun key(name: String, v: Double? = null, c: Double? = null, special: Boolean = false) = BookOrderKey(v, c, special, name)
        val books = listOf(
            key("c121", c = 121.0),
            key("Artbook"),
            key("v10", v = 10.0),
            key("v2", v = 2.0),
            key("c120.5", c = 120.5),
            key("v2 extra", v = 2.0, special = true),
            key("v20", v = 20.0),
        )
        assertEquals(
            listOf("v2", "v2 extra", "v10", "v20", "c120.5", "c121", "Artbook"),
            books.sortedWith(bookOrder).map { it.fileName },
        )
    }

    @Test
    fun `a story arc reads in its folder's order, not by issue number`() {
        fun key(name: String, c: Double?) = BookOrderKey(null, c, false, name)
        val arc = listOf(
            key("010 Infinity Wars - Arachknight 001", 1.0),
            key("001 Infinity Wars Prime 001", 1.0),
            key("003 Infinity Wars 001", 1.0),
            key("000b (prelude) Thanos 002", 2.0),
        )
        assertEquals(
            listOf("000b (prelude) Thanos 002", "001 Infinity Wars Prime 001", "003 Infinity Wars 001", "010 Infinity Wars - Arachknight 001"),
            arc.sortedInReadingOrder { it }.map { it.fileName },
        )
        val series = listOf(key("Batman 010", 10.0), key("Batman 002", 2.0))
        assertEquals(listOf("Batman 002", "Batman 010"), series.sortedInReadingOrder { it }.map { it.fileName })
    }

    @Test
    fun `natural compare orders numbers by value`() {
        assertEquals(listOf("page1", "page2", "page10"), listOf("page10", "page2", "page1").sortedWith(::naturalCompare))
        assertEquals(listOf("0001.jpg", "0002.png", "0010.jpg"), listOf("0010.jpg", "0001.jpg", "0002.png").sortedWith(::naturalCompare))
    }
}
