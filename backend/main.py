from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
import pathlib
import shutil
import uuid

import modal
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import whisperx
from google import genai

from config import (
    S3_BUCKET,
    COOKIE_PATH,
    MAX_CLIP_WORKERS,
    WHISPERX_MODEL_SIZE,
    WHISPERX_DEVICE,
    WHISPERX_COMPUTE_TYPE,
)
from models import ProcessVideoRequest, TranscribeAudioRequest, ProcessSegmentsRequest
from ai.viral_moments import identify_viral_moments
from downloader.youtube import download_youtube_video
from storage.s3 import get_s3_client, upload_to_s3
from transcription.utils import filter_transcript_by_time
from transcription.whisperx_service import transcribe_s3_audio, transcribe_video
from video.processing import process_clip, process_segment

MODAL_APP_NAME = os.environ.get("MODAL_APP_NAME", "slayshot")
MODAL_SECRET_NAME = os.environ.get("MODAL_SECRET_NAME", "slayshot-secret")
MODAL_VOLUME_NAME = os.environ.get("MODAL_VOLUME_NAME", "slayshot-model-cache")

image = (
    modal.Image
    .from_registry("nvidia/cuda:12.4.0-devel-ubuntu22.04", add_python="3.12")
    .apt_install(["ffmpeg", "libgl1-mesa-glx", "wget", "patch", "libcudnn8", "libcudnn8-dev", "python3-pip"])
    .pip_install_from_requirements("requirements.txt")
    .pip_install(["yt-dlp"])
    .run_commands([
        "mkdir -p /usr/share/fonts/truetype/custom",
        "wget -O /usr/share/fonts/truetype/custom/Anton-Regular.ttf https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf",
        "fc-cache -f -v",
    ])
    .run_commands([
        "mkdir -p /usr/share/fonts/truetype/custom",
        "wget -O /usr/share/fonts/truetype/custom/Montserrat-Bold.ttf https://github.com/JulietaUla/Montserrat/raw/refs/heads/master/fonts/ttf/Montserrat-Bold.ttf",
        "fc-cache -f -v",
    ])
    .run_commands([
        "echo yt-dlp-update-2025-01-03",
        "pip install -U yt-dlp",
    ])
    .add_local_dir("asd", "/asd", copy=True)
    .add_local_file(
        "patches/lr-asd-numpy-int.patch",
        remote_path="/tmp/lr-asd-numpy-int.patch",
        copy=True,
    )
    .run_commands([
        "patch -d /asd -p1 < /tmp/lr-asd-numpy-int.patch",
    ])
    .add_local_dir("ai", "/root/ai", copy=True)
    .add_local_dir("downloader", "/root/downloader", copy=True)
    .add_local_dir("storage", "/root/storage", copy=True)
    .add_local_dir("transcription", "/root/transcription", copy=True)
    .add_local_dir("video", "/root/video", copy=True)
    .add_local_file("config.py", remote_path="/root/config.py", copy=True)
    .add_local_file("models.py", remote_path="/root/models.py", copy=True)
)

if pathlib.Path("./cookies.txt").exists():
    image = image.add_local_file("./cookies.txt", remote_path=COOKIE_PATH)


app = modal.App(MODAL_APP_NAME, image=image)

volume = modal.Volume.from_name(MODAL_VOLUME_NAME, create_if_missing=True)

mount_path = "/root/.cache/torch"

auth_scheme = HTTPBearer()


@app.cls(
    gpu="L40S",
    timeout=85000,
    retries=0,
    scaledown_window=20,
    secrets=[modal.Secret.from_name(MODAL_SECRET_NAME)],
    volumes={mount_path: volume},
)
class OmenClipper:
    @modal.enter()
    def load_model(self):
        if not S3_BUCKET:
            raise RuntimeError("S3_BUCKET_NAME is required")

        self.whisperx_model = whisperx.load_model(
            WHISPERX_MODEL_SIZE, device=WHISPERX_DEVICE, compute_type=WHISPERX_COMPUTE_TYPE,
        )
        self.alignment_model, self.metadata = whisperx.load_align_model(
            language_code="en", device=WHISPERX_DEVICE,
        )

        self.gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

        print("Transcription models loaded...")

    @modal.fastapi_endpoint(method="POST")
    def process_video(self, request: ProcessVideoRequest, token: HTTPAuthorizationCredentials = Depends(auth_scheme)):
        if token.credentials != os.environ["AUTH_TOKEN"]:
            raise HTTPException(
                status_code=401,
                detail="Incorrect bearer token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        run_id = str(uuid.uuid4())
        base_dir = pathlib.Path("/tmp") / run_id
        base_dir.mkdir(parents=True, exist_ok=True)

        video_path = base_dir / "input_video.mp4"

        print(f"Processing YouTube URL: {request.youtube_url}")

        download_success = download_youtube_video(
            request.youtube_url,
            str(video_path),
            start_time=request.start_time,
            end_time=request.end_time,
        )

        if not download_success:
            raise HTTPException(status_code=500, detail="Failed to download YouTube video")

        s3_key = f"{request.uuid}/original.mp4"
        upload_success = upload_to_s3(str(video_path), s3_key)

        if not upload_success:
            raise HTTPException(status_code=500, detail="Failed to upload video to S3")

        transcript_json = transcribe_video(
            base_dir,
            video_path,
            self.whisperx_model,
            self.alignment_model,
            self.metadata,
        )

        transcript = json.loads(transcript_json)

        print("identifying..")
        identified_moments = identify_viral_moments(self.gemini_client, transcript)

        clean_json_string = identified_moments.strip()
        if clean_json_string.startswith("```json"):
            clean_json_string = clean_json_string[len("```json"):].strip()
        if clean_json_string.endswith("```"):
            clean_json_string = clean_json_string[:-len("```")].strip()

        clip_moments = json.loads(clean_json_string)
        if not isinstance(clip_moments, list):
            print("Error")
            clip_moments = []

        print(clip_moments)

        uuid_or_s3_key = request.uuid
        layout_value = (request.layout or "full").lower()
        bait_value = request.bait_video or "minecraft_night"

        def process_single_clip(clip_data):
            index, moment = clip_data

            try:
                if "start" in moment and "end" in moment:
                    virality_score = moment.get("virality_score")
                    print(f"Processing clip {index} from {moment['start']} to {moment['end']} (virality: {virality_score})")
                    clip_metadata = process_clip(
                        base_dir,
                        video_path,
                        uuid_or_s3_key,
                        moment["start"],
                        moment["end"],
                        index,
                        transcript,
                        is_uuid=True,
                        layout=layout_value,
                        bait_video=bait_value,
                        virality_score=virality_score,
                    )

                    processed_clip = {
                        "index": index,
                        "start_time": moment["start"],
                        "end_time": moment["end"],
                        "virality_score": virality_score,
                        "metadata": clip_metadata,
                    }

                    print(f"Successfully processed clip {index}")
                    return processed_clip
                else:
                    print(f"Skipping clip {index} - missing start or end time")
                    return None

            except Exception as e:
                print(f"Error processing clip {index}: {str(e)}")
                raise Exception(f"Failed to process clip {index}: {str(e)}")

        processed_clips = []
        metadata_s3_key = None
        valid_clip_moments = [
            (index, moment) for index, moment in enumerate(clip_moments)
            if "start" in moment and "end" in moment
        ]

        if valid_clip_moments:
            print(f"Starting concurrent processing of {len(valid_clip_moments)} clips with max {MAX_CLIP_WORKERS} workers...")

            with ThreadPoolExecutor(max_workers=MAX_CLIP_WORKERS) as executor:
                future_to_clip = {
                    executor.submit(process_single_clip, clip_data): clip_data[0]
                    for clip_data in valid_clip_moments
                }

                for future in as_completed(future_to_clip):
                    clip_index = future_to_clip[future]
                    try:
                        processed_clip = future.result()
                        if processed_clip:
                            processed_clips.append(processed_clip)
                        print(f"Completed clip {clip_index}")
                    except Exception as e:
                        print(f"Clip {clip_index} failed with error: {str(e)}")
                        raise e

            processed_clips.sort(key=lambda x: x["index"])
            print("All clips processed successfully!")

            if processed_clips:
                metadata = {
                    "clips": [clip["metadata"] for clip in processed_clips if "metadata" in clip],
                }

                metadata_path = base_dir / "metadata.json"
                with open(metadata_path, 'w') as f:
                    json.dump(metadata, f, indent=2)

                metadata_s3_key = f"{uuid_or_s3_key}/metadata.json"
                s3_client = get_s3_client()
                s3_client.upload_file(str(metadata_path), S3_BUCKET, metadata_s3_key)
                print(f"Metadata uploaded to S3: {metadata_s3_key}")

        if base_dir.exists():
            print(f"Cleaning up temp dir {base_dir}")
            shutil.rmtree(base_dir, ignore_errors=True)

        return {
            "success": True,
            "clip_count": len(processed_clips),
            "run_id": run_id,
            "processed_clips": processed_clips,
            "metadata_s3_key": metadata_s3_key,
        }

    @modal.fastapi_endpoint(method="POST")
    def transcribe_audio(self, request: TranscribeAudioRequest, token: HTTPAuthorizationCredentials = Depends(auth_scheme)):
        """Transcribe an audio file from S3 and return the transcript."""
        if token.credentials != os.environ["AUTH_TOKEN"]:
            raise HTTPException(
                status_code=401,
                detail="Incorrect bearer token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        try:
            print(f"Transcribing audio file: {request.s3_key}")
            transcript_json = transcribe_s3_audio(
                request.s3_key,
                self.whisperx_model,
                self.alignment_model,
                self.metadata,
            )
            transcript = json.loads(transcript_json)

            return {
                "success": True,
                "transcript": transcript,
                "word_count": len(transcript),
            }

        except Exception as e:
            print(f"Error transcribing audio: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to transcribe audio: {str(e)}")

    @modal.fastapi_endpoint(method="POST")
    def process_segments(self, request: ProcessSegmentsRequest, token: HTTPAuthorizationCredentials = Depends(auth_scheme)):
        """Process pre-segmented video clips using provided transcript."""
        if token.credentials != os.environ["AUTH_TOKEN"]:
            raise HTTPException(
                status_code=401,
                detail="Incorrect bearer token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        if not request.segments or len(request.segments) == 0:
            raise HTTPException(status_code=400, detail="segments array cannot be empty")

        if not request.uuid:
            raise HTTPException(status_code=400, detail="uuid is required")

        if not request.transcript_s3_key:
            raise HTTPException(status_code=400, detail="transcript_s3_key is required")

        run_id = str(uuid.uuid4())
        base_dir = pathlib.Path("/tmp") / run_id
        base_dir.mkdir(parents=True, exist_ok=True)

        try:
            print(f"Processing {len(request.segments)} video segments for UUID: {request.uuid}")

            print(f"Downloading full transcript from: {request.transcript_s3_key}")
            transcript_path = base_dir / "full_transcript.json"
            s3_client = get_s3_client()
            s3_client.download_file(S3_BUCKET, request.transcript_s3_key, str(transcript_path))

            with open(transcript_path, 'r') as f:
                full_transcript = json.load(f)

            print(f"Full transcript loaded with {len(full_transcript)} words")

            layout_value = (request.layout or "full").lower()
            bait_value = request.bait_video or "minecraft_night"

            def process_single_segment(segment_data):
                index, segment_info = segment_data

                try:
                    print(f"Processing segment {index}: {segment_info.s3_key} ({segment_info.start_time}s-{segment_info.end_time}s)")

                    thread_s3_client = get_s3_client()

                    segment_path = base_dir / f"segment_{index}.mp4"
                    thread_s3_client.download_file(S3_BUCKET, segment_info.s3_key, str(segment_path))

                    print(f"Filtering transcript for segment {index}...")
                    segment_transcript = filter_transcript_by_time(
                        full_transcript,
                        segment_info.start_time,
                        segment_info.end_time,
                    )

                    print(f"Segment {index} transcript filtered to {len(segment_transcript)} words")

                    print(f"Processing segment {index} into portrait video...")
                    clip_metadata = process_segment(
                        base_dir,
                        segment_path,
                        request.uuid,
                        index,
                        segment_transcript,
                        layout=layout_value,
                        bait_video=bait_value,
                        virality_score=getattr(segment_info, 'virality_score', None),
                        start_time=segment_info.start_time,
                        end_time=segment_info.end_time,
                    )

                    processed_clip = {
                        "index": index,
                        "original_s3_key": segment_info.s3_key,
                        "output_s3_key": f"{request.uuid}/clip_{index}.mp4",
                        "start_time": segment_info.start_time,
                        "end_time": segment_info.end_time,
                        "metadata": clip_metadata,
                    }

                    print(f"Successfully processed segment {index}")
                    return processed_clip

                except Exception as e:
                    print(f"Error processing segment {index}: {str(e)}")
                    raise Exception(f"Failed to process segment {index}: {str(e)}")

            processed_clips = []
            segment_data_list = list(enumerate(request.segments))

            print(f"Starting concurrent processing with max {MAX_CLIP_WORKERS} workers...")

            with ThreadPoolExecutor(max_workers=MAX_CLIP_WORKERS) as executor:
                future_to_segment = {
                    executor.submit(process_single_segment, segment_data): segment_data[0]
                    for segment_data in segment_data_list
                }

                for future in as_completed(future_to_segment):
                    segment_index = future_to_segment[future]
                    try:
                        processed_clip = future.result()
                        processed_clips.append(processed_clip)
                        print(f"Completed segment {segment_index}")
                    except Exception as e:
                        print(f"Segment {segment_index} failed with error: {str(e)}")
                        raise e

            processed_clips.sort(key=lambda x: x["index"])

            print("All segments processed successfully!")

            metadata = {
                "clips": [clip["metadata"] for clip in processed_clips if "metadata" in clip],
            }

            metadata_path = base_dir / "metadata.json"
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2)

            metadata_s3_key = f"{request.uuid}/metadata.json"
            s3_client.upload_file(str(metadata_path), S3_BUCKET, metadata_s3_key)
            print(f"Metadata uploaded to S3: {metadata_s3_key}")

            return {
                "success": True,
                "clip_count": len(processed_clips),
                "processed_clips": processed_clips,
                "metadata_s3_key": metadata_s3_key,
                "uuid": request.uuid,
            }

        except Exception as e:
            print(f"Error processing segments: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to process segments: {str(e)}")

        finally:
            if base_dir.exists():
                print(f"Cleaning up temp dir {base_dir}")
                shutil.rmtree(base_dir, ignore_errors=True)


@app.local_entrypoint()
def main():
    import requests

    omen_clipper = OmenClipper()

    url = omen_clipper.process_video.web_url

    # Example: process a YouTube video
    payload = {
        "youtube_url": "https://www.youtube.com/watch?v=ANV6fbhTjyU",
        "uuid": "010882aa-c6ee-4b10-9ee9-03fba1199eff",
        "layout": "full",  # "full" or "split"
        # "bait_video": "minecraft_night",  # only used with "split" layout
        # "start_time": 0,    # optional: start time in seconds
        # "end_time": 200,    # optional: end time in seconds
    }

    # Example: transcribe audio only
    # audio_url = omen_clipper.transcribe_audio.web_url
    # audio_payload = {"s3_key": "your-folder/audio.wav"}
    # audio_response = requests.post(audio_url, json=audio_payload, headers=headers)

    # Example: process pre-segmented clips
    # segments_url = omen_clipper.process_segments.web_url
    # segments_payload = {
    #     "segments": [
    #         {"start_time": 10.0, "end_time": 50.0, "s3_key": "your-uuid/segment_0.mp4"},
    #         {"start_time": 60.0, "end_time": 100.0, "s3_key": "your-uuid/segment_1.mp4"},
    #     ],
    #     "uuid": "your-uuid-here",
    #     "transcript_s3_key": "your-uuid/transcript.json",
    #     "layout": "split",
    #     "bait_video": "minecraft_night",
    # }
    # segments_response = requests.post(segments_url, json=segments_payload, headers=headers)

    auth_token = os.environ.get("AUTH_TOKEN")
    if not auth_token:
        raise RuntimeError(
            "AUTH_TOKEN must be set locally to call the authenticated Modal web endpoint."
        )

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {auth_token}",
    }

    print(f"Sending request to {url} with payload {payload}")

    try:
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status()
        result = response.json()
        print(f"Success! Result: {result}")
    except Exception as e:
        print(f"Error: {e}")
        if hasattr(e, 'response') and e.response:
            try:
                print(f"Response status: {e.response.status_code}")
                print(f"Response body: {e.response.text}")
            except:
                pass
