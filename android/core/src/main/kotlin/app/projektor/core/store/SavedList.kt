package app.projektor.core.store

import java.io.File
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonArray

/**
 * A list kept in a JSON file, read and written entry by entry.
 *
 * The entries hold the server's models as they were when saved, and a later build of the app can
 * require a field they lack. Read as one list, a single such entry emptied the whole list, and the
 * next save wrote that empty list over the file. Here a field the entry lacks reads as null where
 * the model allows it, an entry that still cannot be read is kept as it was saved and written
 * back, and a file that is not a list at all is set aside rather than overwritten.
 */
class SavedList<T>(
    private val file: File,
    private val serializer: KSerializer<T>,
    private val onUnreadable: (Throwable) -> Unit = {},
) {
    // Reading forgives a missing nullable field; writing still spells nulls out, so the file stays
    // readable to an older build of the app, which requires every field.
    private val reader = Json { ignoreUnknownKeys = true; explicitNulls = false }
    private val writer = Json
    private var unread: List<JsonElement> = emptyList()

    fun load(): List<T> {
        if (!file.exists()) return emptyList()
        val saved = runCatching { reader.parseToJsonElement(file.readText()).jsonArray }.getOrElse {
            onUnreadable(it)
            runCatching { file.copyTo(File(file.path + ".unreadable"), overwrite = true) }
            return emptyList()
        }
        val read = mutableListOf<T>()
        val kept = mutableListOf<JsonElement>()
        for (entry in saved) {
            runCatching { reader.decodeFromJsonElement(serializer, entry) }
                .onSuccess { read += it }
                .onFailure { kept += entry; onUnreadable(it) }
        }
        unread = kept
        return read
    }

    /** Replaces the file in one step, so a crash mid-write leaves the previous list. */
    fun save(entries: List<T>) {
        val all = JsonArray(entries.map { writer.encodeToJsonElement(serializer, it) } + unread)
        val tmp = File(file.path + ".tmp")
        tmp.writeText(writer.encodeToString(JsonArray.serializer(), all))
        tmp.renameTo(file)
    }
}
