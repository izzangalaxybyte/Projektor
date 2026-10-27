package app.projektor.player

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.ExtractorsFactory
import androidx.media3.extractor.OpusUtil
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.TrackOutput
import androidx.media3.extractor.text.SubtitleParser

/**
 * Gives each Opus packet in a laced Matroska block its own timestamp. Media3 times laced packets
 * from the track's default duration, which Opus tracks often lack, so every packet in a block got
 * the block's time. Playing straight through that went unnoticed, but after a seek the player
 * dropped or kept whole blocks by those times: the audio then ran up to a second off the picture
 * until the next seek.
 */
@OptIn(UnstableApi::class)
class LacedOpusExtractorsFactory(private val delegate: ExtractorsFactory) : ExtractorsFactory {
    override fun createExtractors(): Array<Extractor> = delegate.createExtractors().map(::LacedOpusExtractor).toTypedArray()
    override fun createExtractors(uri: Uri, responseHeaders: Map<String, List<String>>): Array<Extractor> =
        delegate.createExtractors(uri, responseHeaders).map(::LacedOpusExtractor).toTypedArray()
    override fun setSubtitleParserFactory(subtitleParserFactory: SubtitleParser.Factory): ExtractorsFactory =
        apply { delegate.setSubtitleParserFactory(subtitleParserFactory) }
    @Deprecated("Deprecated in Media3")
    override fun experimentalSetTextTrackTranscodingEnabled(textTrackTranscodingEnabled: Boolean): ExtractorsFactory =
        apply { @Suppress("DEPRECATION") delegate.experimentalSetTextTrackTranscodingEnabled(textTrackTranscodingEnabled) }
    override fun experimentalSetCodecsToParseWithinGopSampleDependencies(codecsToParseWithinGopSampleDependencies: Int): ExtractorsFactory =
        apply { delegate.experimentalSetCodecsToParseWithinGopSampleDependencies(codecsToParseWithinGopSampleDependencies) }
}

@OptIn(UnstableApi::class)
private class LacedOpusExtractor(private val delegate: Extractor) : Extractor {
    private val tracks = mutableListOf<OpusTrackOutput>()

    override fun sniff(input: ExtractorInput) = delegate.sniff(input)
    override fun getSniffFailureDetails() = delegate.sniffFailureDetails
    override fun read(input: ExtractorInput, seekPosition: PositionHolder) = delegate.read(input, seekPosition)
    override fun release() = delegate.release()
    override fun getUnderlyingImplementation(): Extractor = delegate.underlyingImplementation
    override fun seek(position: Long, timeUs: Long) {
        tracks.forEach { it.reset() }
        delegate.seek(position, timeUs)
    }
    override fun init(output: ExtractorOutput) = delegate.init(object : ExtractorOutput {
        override fun track(id: Int, type: Int): TrackOutput =
            if (type == C.TRACK_TYPE_AUDIO) OpusTrackOutput(output.track(id, type)).also { tracks += it } else output.track(id, type)
        override fun endTracks() = output.endTracks()
        override fun seekMap(seekMap: SeekMap) = output.seekMap(seekMap)
    })
}

/** Passes everything through; for Opus, retimes packets that repeat the previous packet's block time. */
@OptIn(UnstableApi::class)
internal class OpusTrackOutput(private val out: TrackOutput) : TrackOutput {
    private var opus = false
    private val scratch = ParsableByteArray()
    /** Opening bytes of the sample being written; its TOC gives the packet's duration. */
    private val head = ByteArray(2)
    private var headSize = 0
    private var blockTimeUs = C.TIME_UNSET
    private var nextTimeUs = C.TIME_UNSET

    fun reset() { blockTimeUs = C.TIME_UNSET; nextTimeUs = C.TIME_UNSET; headSize = 0 }

    override fun format(format: Format) {
        opus = format.sampleMimeType == MimeTypes.AUDIO_OPUS
        out.format(if (opus) withoutSeekPreRoll(format) else format)
    }
    override fun durationUs(durationUs: Long) = out.durationUs(durationUs)

    override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean, sampleDataPart: Int): Int {
        if (!opus || sampleDataPart != TrackOutput.SAMPLE_DATA_PART_MAIN) return out.sampleData(input, length, allowEndOfInput, sampleDataPart)
        scratch.reset(length)
        val read = input.read(scratch.data, 0, length)
        if (read == C.RESULT_END_OF_INPUT) {
            if (allowEndOfInput) return C.RESULT_END_OF_INPUT
            throw java.io.EOFException()
        }
        scratch.setLimit(read)
        remember(scratch.data, 0, read)
        out.sampleData(scratch, read, sampleDataPart)
        return read
    }

    override fun sampleData(data: ParsableByteArray, length: Int, sampleDataPart: Int) {
        if (opus && sampleDataPart == TrackOutput.SAMPLE_DATA_PART_MAIN) remember(data.data, data.position, length)
        out.sampleData(data, length, sampleDataPart)
    }

    private fun remember(bytes: ByteArray, from: Int, length: Int) {
        var i = 0
        while (headSize < head.size && i < length) head[headSize++] = bytes[from + i++]
    }

    override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: TrackOutput.CryptoData?) {
        if (!opus) return out.sampleMetadata(timeUs, flags, size, offset, cryptoData)
        val adjusted = if (timeUs == blockTimeUs && nextTimeUs != C.TIME_UNSET) nextTimeUs else timeUs
        blockTimeUs = timeUs
        val durationUs = if (headSize > 0) OpusUtil.getPacketDurationUs(head) else 0
        nextTimeUs = if (durationUs > 0) adjusted + durationUs else C.TIME_UNSET
        headSize = 0
        head.fill(0)
        out.sampleMetadata(adjusted, flags, size, offset, cryptoData)
    }
}

/**
 * Matroska hands Opus its seek pre-roll as the third initialization buffer. The platform decoder
 * then discards that much output after every flush, yet keeps each buffer's timestamp, so after a
 * seek the sound ran 74 ms ahead of the picture. The player already decodes from before the seek
 * target and drops what precedes it, so the decoder need not discard anything itself.
 */
@OptIn(UnstableApi::class)
private fun withoutSeekPreRoll(format: Format): Format {
    val init = format.initializationData
    if (init.size < 3) return format
    return format.buildUpon().setInitializationData(listOf(init[0], init[1], ByteArray(init[2].size))).build()
}
