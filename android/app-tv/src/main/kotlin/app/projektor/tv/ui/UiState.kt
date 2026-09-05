package app.projektor.tv.ui

sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    data class Ready<T>(val value: T) : UiState<T>
    data class Failed(val message: String) : UiState<Nothing>
}

fun Throwable.userMessage(): String = message?.takeIf { it.isNotBlank() } ?: this::class.simpleName ?: "Something went wrong"

fun formatMs(ms: Long): String {
    val total = ms / 1000
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

fun captionFor(kind: String, seasonNumber: Int?, episodeNumber: Int?, showTitle: String?, year: Int?): String = when (kind) {
    "episode" -> buildString {
        seasonNumber?.let { append("S$it ") }
        append("E${episodeNumber ?: "?"}")
        showTitle?.let { append(" · $it") }
    }
    "season" -> showTitle ?: ""
    else -> year?.toString() ?: ""
}
