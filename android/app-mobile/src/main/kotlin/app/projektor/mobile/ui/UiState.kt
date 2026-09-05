package app.projektor.mobile.ui

/** Loading / loaded / failed for screens that fetch once. */
sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    data class Ready<T>(val value: T) : UiState<T>
    data class Failed(val message: String) : UiState<Nothing>
}

fun Throwable.userMessage(): String = message?.takeIf { it.isNotBlank() } ?: this::class.simpleName ?: "Something went wrong"
