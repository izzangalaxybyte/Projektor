package app.projektor.core.comics

/**
 * Reading order within a series, the same as the server's (server/src/comics/naming.ts): volumes,
 * then loose chapters after them, then unnumbered books; specials after the book they sit beside.
 * Used offline, where only the downloaded books of a series are known.
 */
data class BookOrderKey(val volume: Double?, val chapter: Double?, val special: Boolean, val fileName: String)

val bookOrder: Comparator<BookOrderKey> = Comparator { a, b ->
    fun group(x: BookOrderKey) = if (x.volume != null) 0 else if (x.chapter != null) 1 else 2
    group(a).compareTo(group(b)).takeIf { it != 0 }
        ?: (a.volume ?: 0.0).compareTo(b.volume ?: 0.0).takeIf { it != 0 }
        ?: (a.chapter ?: -1.0).compareTo(b.chapter ?: -1.0).takeIf { it != 0 }
        ?: a.special.compareTo(b.special).takeIf { it != 0 }
        ?: naturalCompare(a.fileName, b.fileName)
}

private val readingOrderPrefix = Regex("^\\d{1,4}[a-zA-Z]?(?=[\\s._()-])")

/**
 * Story-arc folders number their books in the order to read them, ahead of each book's own issue
 * number ("010 Infinity Wars - Arachknight 001"); when most books do, that order wins. Mirrors
 * inReadingOrder in the server's naming.ts.
 */
fun inReadingOrder(fileNames: List<String>): Boolean =
    fileNames.size >= 2 && fileNames.count { readingOrderPrefix.containsMatchIn(it) } >= fileNames.size * 0.8

/** One series' books in reading order, by [bookOrder] or, for a story arc, by file name. */
fun <T> List<T>.sortedInReadingOrder(key: (T) -> BookOrderKey): List<T> =
    if (inReadingOrder(map { key(it).fileName })) sortedWith { a, b -> naturalCompare(key(a).fileName, key(b).fileName) }
    else sortedWith(compareBy(bookOrder, key))

/** "page2" before "page10", case ignored. */
fun naturalCompare(a: String, b: String): Int {
    val ta = Regex("\\d+|\\D+").findAll(a.lowercase()).map { it.value }.toList()
    val tb = Regex("\\d+|\\D+").findAll(b.lowercase()).map { it.value }.toList()
    for (i in 0 until minOf(ta.size, tb.size)) {
        val x = ta[i]
        val y = tb[i]
        val c = if (x[0].isDigit() && y[0].isDigit()) {
            x.trimStart('0').length.compareTo(y.trimStart('0').length).takeIf { it != 0 }
                ?: x.trimStart('0').compareTo(y.trimStart('0'))
        } else {
            x.compareTo(y)
        }
        if (c != 0) return c
    }
    return ta.size.compareTo(tb.size)
}
