package app.projektor.player

import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.extractor.TrackOutput
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class LacedOpusTimestampsTest {
    private class Recorder : TrackOutput {
        var format: Format? = null
        val times = mutableListOf<Long>()
        override fun format(format: Format) { this.format = format }
        override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean, sampleDataPart: Int) = length
        override fun sampleData(data: ParsableByteArray, length: Int, sampleDataPart: Int) = data.skipBytes(length)
        override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: TrackOutput.CryptoData?) { times += timeUs }
    }

    /** A 120 ms Opus packet: CELT fullband 20 ms frames (config 31), code 3, six frames. */
    private fun packet() = byteArrayOf(0xFB.toByte(), 6, 0, 0)

    private fun write(out: TrackOutput, timeUs: Long) {
        val p = packet()
        out.sampleData(ParsableByteArray(p), p.size, TrackOutput.SAMPLE_DATA_PART_MAIN)
        out.sampleMetadata(timeUs, 0, p.size, 0, null)
    }

    private fun opus(init: List<ByteArray>) = Format.Builder().setSampleMimeType(MimeTypes.AUDIO_OPUS).setInitializationData(init).build()

    @Test
    fun `packets laced into one block are timed one after another`() {
        val rec = Recorder()
        val out = OpusTrackOutput(rec).apply { format(opus(emptyList())) }
        repeat(3) { write(out, 1_000_000) }
        write(out, 1_360_000)
        write(out, 1_360_000)
        assertEquals(listOf(1_000_000L, 1_120_000L, 1_240_000L, 1_360_000L, 1_480_000L), rec.times)
    }

    @Test
    fun `after a seek the next block starts from its own time`() {
        val rec = Recorder()
        val out = OpusTrackOutput(rec).apply { format(opus(emptyList())) }
        write(out, 5_000_000)
        out.reset()
        write(out, 5_000_000)
        assertEquals(listOf(5_000_000L, 5_000_000L), rec.times)
    }

    @Test
    fun `the seek pre-roll is zeroed so the decoder keeps its first output after a seek`() {
        val rec = Recorder()
        val head = byteArrayOf(1, 2, 3)
        val delay = byteArrayOf(4, 5, 6, 7, 8, 9, 10, 11)
        OpusTrackOutput(rec).format(opus(listOf(head, delay, byteArrayOf(0, 0x2D, 0x31, 1, 0, 0, 0, 0))))
        val init = rec.format!!.initializationData
        assertArrayEquals(head, init[0])
        assertArrayEquals(delay, init[1])
        assertArrayEquals(ByteArray(8), init[2])
    }
}
