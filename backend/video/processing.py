import os
import pathlib
import pickle
import shutil
import subprocess
import time

from config import S3_BUCKET, COLUMBIA_CWD, COLUMBIA_MODEL_PATH, SUBTITLE_MAX_WORDS
from storage.s3 import download_bait_video, get_s3_client
from transcription.utils import transcript_to_string
from video.portrait import create_portrait_vid, create_portrait_vid_top_half
from video.subtitles import burn_subtitles


def process_segment(
    base_dir: pathlib.Path,
    segment_video_path,
    uuid: str,
    clip_index: int,
    transcript: list,
    layout: str = "full",
    bait_video: str | None = "minecraft_night",
    virality_score: int | None = None,
    start_time: float | None = None,
    end_time: float | None = None,
):
    """Process a pre-segmented video clip (no time cutting needed)."""
    clip_name = f"clip_{clip_index}"
    output_s3_key = f"{uuid}/clip_{clip_index}.mp4"

    print(f"Processing segment {clip_index} - Output s3 key: {output_s3_key}")

    clip_dir = base_dir / clip_name
    clip_dir.mkdir(parents=True, exist_ok=True)

    vertical_mp4_path = clip_dir / "pyavi" / "video_out_vertical.mp4"
    subtitle_output_path = clip_dir / "pyavi" / "video_with_subtitles.mp4"

    (clip_dir / "pywork").mkdir(exist_ok=True)

    pyframes_path = clip_dir / "pyframes"
    pyavi_path = clip_dir / "pyavi"
    audio_path = clip_dir / "pyavi" / "audio.wav"
    bait_path = clip_dir / "pyavi" / "bait_video.mp4"

    pyframes_path.mkdir(exist_ok=True)
    pyavi_path.mkdir(exist_ok=True)

    extract_audio_cmd = f"ffmpeg -i {segment_video_path} -vn -acodec pcm_s16le -ar 16000 -ac 1 {audio_path}"
    subprocess.run(extract_audio_cmd, shell=True, check=True, capture_output=True, text=True)

    shutil.copy(segment_video_path, base_dir / f"{clip_name}.mp4")

    columbia_command = (
        f"python Columbia_test.py --videoName {clip_name} "
        f"--videoFolder {str(base_dir)} "
        f"--pretrainModel {COLUMBIA_MODEL_PATH}"
    )
    columbia_start_time = time.time()
    subprocess.run(columbia_command, cwd=COLUMBIA_CWD, shell=True)
    columbia_end_time = time.time()

    print(f"Columbia ASD complete in {columbia_end_time - columbia_start_time:.2f} s")

    tracks_path = clip_dir / "pywork" / "tracks.pckl"
    scores_path = clip_dir / "pywork" / "scores.pckl"
    if not tracks_path.exists() or not scores_path.exists():
        raise FileNotFoundError("Tracks or scores not found")

    with open(tracks_path, "rb") as f:
        tracks = pickle.load(f)

    with open(scores_path, "rb") as f:
        scores = pickle.load(f)

    local_bait_path: str | None = None
    if (layout or "full").lower() == "split" and bait_video:
        local_bait_path = download_bait_video(bait_video, bait_path)

    result = subprocess.run(
        f"ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 {segment_video_path}",
        shell=True, capture_output=True, text=True,
    )
    duration = float(result.stdout.strip()) if result.stdout.strip() else 60.0

    portrait_start_time = time.time()
    if (layout or "full").lower() == "split":
        create_portrait_vid_top_half(
            tracks, scores, pyframes_path, pyavi_path, audio_path,
            vertical_mp4_path, bottom_video_path=local_bait_path,
            clip_duration=duration,
        )
    else:
        create_portrait_vid(
            tracks, scores, pyframes_path, pyavi_path, audio_path,
            vertical_mp4_path,
        )
    portrait_end_time = time.time()

    print(f"Portrait video creation time: {portrait_end_time - portrait_start_time:.2f} s")

    burn_subtitles(
        transcript, 0, duration, vertical_mp4_path,
        subtitle_output_path, max_words=SUBTITLE_MAX_WORDS,
    )

    s3_client = get_s3_client()
    s3_client.upload_file(subtitle_output_path, S3_BUCKET, output_s3_key)

    print(f"Segment {clip_index} uploaded to S3: {output_s3_key}")

    clip_metadata = {
        "clip_index": clip_index,
        "s3_key": output_s3_key,
        "transcript": transcript_to_string(transcript),
        "start_time": start_time,
        "end_time": end_time,
        "virality_score": virality_score,
    }

    return clip_metadata


def process_clip(
    base_dir: pathlib.Path,
    original_video_path,
    uuid_or_s3_key: str,
    start_time: float,
    end_time: float,
    clip_index: int,
    transcript: list,
    is_uuid: bool = False,
    layout: str = "full",
    bait_video: str | None = "minecraft_night",
    virality_score: int | None = None,
):
    """Process a clip by cutting from the original video, then creating portrait + subtitles."""
    clip_name = f"clip_{clip_index}"

    if is_uuid:
        output_s3_key = f"{uuid_or_s3_key}/clip_{clip_index}.mp4"
    else:
        s3_key_dir = os.path.dirname(uuid_or_s3_key)
        output_s3_key = f"{s3_key_dir}/{clip_name}.mp4"

    print(f"Output s3 key: {output_s3_key}")

    clip_dir = base_dir / clip_name
    clip_dir.mkdir(parents=True, exist_ok=True)

    clip_segment_path = clip_dir / f"{clip_name}_segment.mp4"
    vertical_mp4_path = clip_dir / "pyavi" / "video_out_vertical.mp4"
    subtitle_output_path = clip_dir / "pyavi" / "video_with_subtitles.mp4"

    (clip_dir / "pywork").mkdir(exist_ok=True)

    pyframes_path = clip_dir / "pyframes"
    pyavi_path = clip_dir / "pyavi"
    audio_path = clip_dir / "pyavi" / "audio.wav"
    bait_path = clip_dir / "pyavi" / "bait_video.mp4"

    pyframes_path.mkdir(exist_ok=True)
    pyavi_path.mkdir(exist_ok=True)

    clip_duration = end_time - start_time

    cut_command = (
        f"ffmpeg -i {original_video_path} -ss {start_time} -t {clip_duration} "
        f"{clip_segment_path}"
    )

    subprocess.run(cut_command, shell=True, check=True, capture_output=True, text=True)

    extract_audio_cmd = f"ffmpeg -i {clip_segment_path} -vn -acodec pcm_s16le -ar 16000 -ac 1 {audio_path}"

    subprocess.run(extract_audio_cmd, shell=True, check=True, capture_output=True, text=True)

    shutil.copy(clip_segment_path, base_dir / f"{clip_name}.mp4")

    columbia_command = (
        f"python Columbia_test.py --videoName {clip_name} "
        f"--videoFolder {str(base_dir)} "
        f"--pretrainModel {COLUMBIA_MODEL_PATH}"
    )
    columbia_start_time = time.time()
    subprocess.run(columbia_command, cwd=COLUMBIA_CWD, shell=True)

    columbia_end_time = time.time()

    print(f"Col. script complete in {columbia_end_time - columbia_start_time:.2f} s")

    tracks_path = clip_dir / "pywork" / "tracks.pckl"
    scores_path = clip_dir / "pywork" / "scores.pckl"
    if not tracks_path.exists() or not scores_path.exists():
        raise FileNotFoundError("Tracks or scores not found")

    with open(tracks_path, "rb") as f:
        tracks = pickle.load(f)

    with open(scores_path, "rb") as f:
        scores = pickle.load(f)

    portrait_start_time = time.time()

    local_bait_path: str | None = None
    if (layout or "full").lower() == "split" and bait_video:
        local_bait_path = download_bait_video(bait_video, bait_path)

    if (layout or "full").lower() == "split":
        create_portrait_vid_top_half(
            tracks, scores, pyframes_path, pyavi_path, audio_path,
            vertical_mp4_path, bottom_video_path=local_bait_path,
            clip_duration=clip_duration,
        )
    else:
        create_portrait_vid(
            tracks, scores, pyframes_path, pyavi_path, audio_path,
            vertical_mp4_path,
        )

    portrait_end_time = time.time()

    print(f"Clip {clip_index} portrait video creation time: {portrait_end_time - portrait_start_time:.2f} s")

    burn_subtitles(
        transcript, start_time, end_time, vertical_mp4_path,
        subtitle_output_path, max_words=SUBTITLE_MAX_WORDS,
    )

    s3_client = get_s3_client()
    s3_client.upload_file(subtitle_output_path, S3_BUCKET, output_s3_key)

    clip_metadata = {
        "clip_index": clip_index,
        "s3_key": output_s3_key,
        "transcript": transcript_to_string(transcript),
        "start_time": start_time,
        "end_time": end_time,
        "virality_score": virality_score,
    }

    return clip_metadata
