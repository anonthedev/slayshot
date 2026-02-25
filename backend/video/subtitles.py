import os
import subprocess

import pysubs2

from config import (
    TARGET_WIDTH,
    TARGET_HEIGHT,
    SUBTITLE_FONT_NAME,
    SUBTITLE_FONT_SIZE,
    SUBTITLE_MARGIN_V,
    SUBTITLE_MARGIN_LR,
)


def burn_subtitles(
    transcript: list,
    clip_start: float,
    clip_end: float,
    clip_video_path: str,
    output_path: str,
    max_words: int = 5,
):
    temp_dir = os.path.dirname(output_path)
    subtitle_path = os.path.join(temp_dir, "temp_subtitles.ass")

    clip_segments = [
        segment for segment in transcript
        if segment.get("start") is not None
        and segment.get("end") is not None
        and segment.get("end") > clip_start
        and segment.get("start") < clip_end
    ]

    print(f"[DEBUG] Transcript has {len(transcript)} segments")
    print(f"[DEBUG] Filtered transcript has {len(clip_segments)} segments for clip {clip_start:.2f}s-{clip_end:.2f}s")

    subtitles = []
    current_words = []
    current_start = None
    current_end = None

    for segment in clip_segments:
        word = segment.get("word", "").strip()
        seg_start = segment.get("start")
        seg_end = segment.get("end")

        if not word or seg_start is None or seg_end is None:
            continue

        start_rel = max(0.0, seg_start - clip_start)
        end_rel = max(0.0, seg_end - clip_start)

        if end_rel <= 0:
            continue

        if not current_words:
            current_start = start_rel
            current_end = end_rel
            current_words = [segment]
        elif len(current_words) >= max_words:
            subtitles.append((current_start, current_end, current_words))
            current_words = [segment]
            current_start = start_rel
            current_end = end_rel
        else:
            current_words.append(segment)
            current_end = end_rel

    if current_words:
        subtitles.append((current_start, current_end, current_words))

    print(f"[DEBUG] Created {len(subtitles)} subtitle lines")

    subs = pysubs2.SSAFile()
    subs.info["WrapStyle"] = 0
    subs.info["ScaledBorderAndShadow"] = "yes"
    subs.info["PlayResX"] = TARGET_WIDTH
    subs.info["PlayResY"] = TARGET_HEIGHT
    subs.info["ScriptType"] = "v4.00+"

    base_style = pysubs2.SSAStyle()
    base_style.fontname = SUBTITLE_FONT_NAME
    base_style.fontsize = SUBTITLE_FONT_SIZE
    base_style.primarycolor = pysubs2.Color(255, 255, 255)
    base_style.outline = 2.0
    base_style.shadow = 2.0
    base_style.shadowcolor = pysubs2.Color(0, 0, 0, 128)
    base_style.alignment = 2
    base_style.marginl = SUBTITLE_MARGIN_LR
    base_style.marginr = SUBTITLE_MARGIN_LR
    base_style.marginv = SUBTITLE_MARGIN_V
    base_style.spacing = 0.0

    subs.styles["Default"] = base_style

    for start, end, word_segments in subtitles:
        text_parts = []
        for seg in word_segments:
            word = seg["word"].strip()
            if word:
                text_parts.append(word)

        if text_parts:
            subtitle_text = " ".join(text_parts)

            line = pysubs2.SSAEvent(
                start=pysubs2.make_time(s=start),
                end=pysubs2.make_time(s=end),
                text=subtitle_text,
                style="Default",
            )
            subs.events.append(line)

    subs.save(subtitle_path)

    ffmpeg_cmd = (
        f'ffmpeg -y -i {clip_video_path} -vf "ass={subtitle_path}" '
        f"-c:v h264 -preset fast -crf 23 {output_path}"
    )

    subprocess.run(ffmpeg_cmd, shell=True, check=True)
