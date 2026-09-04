#!/usr/bin/env bash
# Generates small synthetic media files for tests into ./fixtures (gitignored).
# Requires ffmpeg and ffprobe on PATH. Safe to re-run; existing files are skipped.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/fixtures}"
DUR="${FIXTURE_SECONDS:-30}"

command -v ffmpeg >/dev/null || { echo "ffmpeg not found" >&2; exit 1; }
command -v ffprobe >/dev/null || { echo "ffprobe not found" >&2; exit 1; }

mkdir -p "$OUT/movies" "$OUT/tv" "$OUT/anime" "$OUT/.work"
WORK="$OUT/.work"

# Common synthetic sources: a colour-bars video and two distinct sine tones.
# Files with subtitle inputs use -t rather than -shortest: -shortest would stop at the
# subtitle stream, whose last cue ends long before DUR.
VIDEO=(-f lavfi -i "testsrc2=size=640x360:rate=24:duration=$DUR")
TONE_A=(-f lavfi -i "sine=frequency=440:sample_rate=48000:duration=$DUR")
TONE_B=(-f lavfi -i "sine=frequency=660:sample_rate=48000:duration=$DUR")

make_srt() {
  cat > "$1" <<SRT
1
00:00:01,000 --> 00:00:04,000
First subtitle line

2
00:00:05,000 --> 00:00:08,000
Second subtitle line
SRT
}

make_ass() {
  cat > "$1" <<ASS
[Script Info]
ScriptType: v4.00+
PlayResX: 640
PlayResY: 360

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,24,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,{\\an8}Styled first line
Dialogue: 0,0:00:05.00,0:00:08.00,Default,,0,0,0,,Second {\\i1}italic{\\i0} line
ASS
}

skip_if_exists() { [ -f "$1" ] && { echo "skip  $(basename "$1")"; return 0; } || return 1; }

# 1. Plex-style movie: h264 + aac in mp4 (direct-play everywhere)
F="$OUT/movies/Sample Movie (2019)/Sample Movie (2019).mp4"
mkdir -p "$(dirname "$F")"
skip_if_exists "$F" || { ffmpeg -v error -y "${VIDEO[@]}" "${TONE_A[@]}" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 96k -shortest \
  -movflags +faststart "$F" && echo "made  $(basename "$F")"; }

# 2. Scene-named episode: hevc + ac3 in mkv with an embedded srt track (transcode case)
make_srt "$WORK/ep.srt"
F="$OUT/tv/Sample.Show.S01E02.1080p.WEB.H265-GRP.mkv"
skip_if_exists "$F" || { ffmpeg -v error -y "${VIDEO[@]}" "${TONE_A[@]}" -i "$WORK/ep.srt" \
  -map 0:v -map 1:a -map 2:s \
  -c:v libx265 -preset ultrafast -pix_fmt yuv420p -tag:v hvc1 -x265-params log-level=error \
  -c:a ac3 -b:a 192k -c:s srt -metadata:s:s:0 language=eng -t "$DUR" "$F" && echo "made  $(basename "$F")"; }

# 3. Loosely named file with no season/episode markers (needs-review case)
F="$OUT/movies/some.random.download.2021.x264-NOGROUP.mp4"
skip_if_exists "$F" || { ffmpeg -v error -y "${VIDEO[@]}" "${TONE_A[@]}" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 96k -shortest "$F" && echo "made  $(basename "$F")"; }

# 4. Fansub-named anime episode: dual audio (jpn + eng) and an embedded ASS track
make_ass "$WORK/anime.ass"
F="$OUT/anime/[SubGroup] Sample Anime - 13 [1080p][HEVC][Dual-Audio].mkv"
skip_if_exists "$F" || { ffmpeg -v error -y "${VIDEO[@]}" "${TONE_A[@]}" "${TONE_B[@]}" -i "$WORK/anime.ass" \
  -map 0:v -map 1:a -map 2:a -map 3:s \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p \
  -c:a aac -b:a 96k -metadata:s:a:0 language=jpn -metadata:s:a:1 language=eng \
  -c:s ass -metadata:s:s:0 language=eng -t "$DUR" "$F" && echo "made  $(basename "$F")"; }

rm -rf "$WORK"
echo
echo "Fixtures in $OUT:"
find "$OUT" -type f \( -name '*.mp4' -o -name '*.mkv' \) | sort | while read -r f; do
  printf '  %s\n' "${f#"$OUT"/}"
  ffprobe -v error -show_entries stream=index,codec_type,codec_name:stream_tags=language \
    -of csv=p=0 "$f" | sed 's/^/      /'
done
