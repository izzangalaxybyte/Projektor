package app.projektor.core.store

import java.io.File
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SavedListTest {
    @get:Rule val tmp = TemporaryFolder()

    // Like the generated models: no defaults, so a missing key is an error unless it may be null.
    @Serializable
    data class Entry(val id: String, val size: Long, val note: String?)

    private fun list(file: File, errors: MutableList<Throwable> = mutableListOf()) = SavedList(file, Entry.serializer()) { errors += it }

    @Test
    fun `saves and loads entries`() {
        val file = File(tmp.root, "list.json")
        list(file).save(listOf(Entry("a", 1, null), Entry("b", 2, "x")))
        assertEquals(listOf(Entry("a", 1, null), Entry("b", 2, "x")), list(file).load())
        // Nulls are spelled out: an older build of the app requires every field.
        assertTrue(file.readText().contains(""""note":null"""))
    }

    @Test
    fun `reads an entry saved before a nullable field existed`() {
        val file = File(tmp.root, "list.json").apply { writeText("""[{"id":"a","size":1,"gone":true}]""") }
        assertEquals(listOf(Entry("a", 1, null)), list(file).load())
    }

    @Test
    fun `an entry it cannot read costs neither the others nor itself`() {
        val file = File(tmp.root, "list.json").apply { writeText("""[{"id":"old"},{"id":"a","size":1}]""") }
        val errors = mutableListOf<Throwable>()
        val saved = list(file, errors)
        assertEquals(listOf(Entry("a", 1, null)), saved.load())
        assertEquals(1, errors.size)
        saved.save(listOf(Entry("a", 5, null)))
        val written = Json.parseToJsonElement(file.readText()).jsonArray
        assertEquals(listOf("a", "old"), written.map { it.jsonObject.getValue("id").jsonPrimitive.content })
    }

    @Test
    fun `sets aside a file that is not a list`() {
        val file = File(tmp.root, "list.json").apply { writeText("{not json") }
        assertEquals(emptyList<Entry>(), list(file).load())
        assertTrue(File(tmp.root, "list.json.unreadable").exists())
    }
}
