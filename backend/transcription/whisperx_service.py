import json
import pathlib
import shutil
import subprocess
import time
import uuid

import whisperx

from config import S3_BUCKET, WHISPERX_BATCH_SIZE, WHISPERX_DEVICE
from storage.s3 import get_s3_client


def _transcribe_wav(
    wav_path: pathlib.Path,
    whisperx_model,
    alignment_model,
    metadata,
) -> str:
    audio = whisperx.load_audio(str(wav_path))
    result = whisperx_model.transcribe(audio, batch_size=WHISPERX_BATCH_SIZE)
    result = whisperx.align(
        result["segments"],
        alignment_model,
        metadata,
        audio,
        device=WHISPERX_DEVICE,
        return_char_alignments=False,
    )

    segments = [
        {
            "start": word_segment["start"],
            "end": word_segment["end"],
            "word": word_segment["word"],
        }
        for word_segment in result.get("word_segments", [])
    ]
    return json.dumps(segments)


def transcribe_video(
    base_dir: pathlib.Path,
    video_path: pathlib.Path,
    whisperx_model,
    alignment_model,
    metadata,
) -> str:
    """Extract a video's audio and return its word-level transcript as JSON."""
    audio_path = base_dir / "audio.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(video_path),
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            str(audio_path),
        ],
        check=True,
        capture_output=True,
    )

    print("Starting transcription with WhisperX...")
    start_time = time.time()
    transcript_json = _transcribe_wav(
        audio_path, whisperx_model, alignment_model, metadata
    )
    print(f"Transcription took {time.time() - start_time:.2f} seconds")
    print(transcript_json)
    return transcript_json


def transcribe_s3_audio(
    audio_s3_key: str,
    whisperx_model,
    alignment_model,
    metadata,
) -> str:
    """Download an audio file from S3 and return its word-level transcript as JSON."""
    temp_dir = pathlib.Path("/tmp") / f"audio_transcription_{uuid.uuid4()}"
    temp_dir.mkdir(parents=True, exist_ok=True)

    try:
        audio_path = temp_dir / "audio_file"
        get_s3_client().download_file(S3_BUCKET, audio_s3_key, str(audio_path))

        wav_path = temp_dir / "audio.wav"
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(audio_path),
                "-vn",
                "-acodec",
                "pcm_s16le",
                "-ar",
                "16000",
                "-ac",
                "1",
                str(wav_path),
            ],
            check=True,
            capture_output=True,
        )

        print("Starting transcription with WhisperX...")
        start_time = time.time()
        transcript_json = _transcribe_wav(
            wav_path, whisperx_model, alignment_model, metadata
        )
        print(f"Audio transcription took {time.time() - start_time:.2f} seconds")
        return transcript_json
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
