import json
import os
import pathlib
import pickle
import shutil
import subprocess
import uuid
import boto3
import cv2
import ffmpegcv
from grpclib import Status
import modal
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
import pysubs2
from tqdm import tqdm
import whisperx
import time
from openai import OpenAI
from google import genai
import numpy as np
import glob
# from pytube import YouTube
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed

class ProcessVideoRequest(BaseModel):
    s3_key: str | None = None
    youtube_url: str | None = None
    uuid: str | None = None  # UUID for organizing files in S3 (required for YouTube URLs)
    start_time: float | None = None  # Start time in seconds (optional)
    end_time: float | None = None  # End time in seconds (optional)

class TranscribeAudioRequest(BaseModel):
    s3_key: str  # S3 key pointing to the audio file

class SegmentInfo(BaseModel):
    s3_key: str  # S3 key for the video segment
    start_time: float  # Start time in seconds
    end_time: float  # End time in seconds

class ProcessSegmentsRequest(BaseModel):
    segments: list[SegmentInfo]  # Array of segment info with S3 keys and timings
    uuid: str  # UUID for organizing output clips in S3
    transcript_s3_key: str  # S3 key for the full transcript JSON file

image = (modal.Image
         .from_registry("nvidia/cuda:12.4.0-devel-ubuntu22.04", add_python="3.12")
         .apt_install(["ffmpeg", "libgl1-mesa-glx", "wget", "libcudnn8", "libcudnn8-dev", "python3-pip"])
         .pip_install_from_requirements("requirements.txt")
         .pip_install(["yt-dlp"])
         .run_commands([
             "mkdir -p /usr/share/fonts/truetype/custom", 
             "wget -O /usr/share/fonts/truetype/custom/Anton-Regular.ttf https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf", 
             "fc-cache -f -v"
            ])
        .add_local_dir("asd", "/asd", copy=True)
        .add_local_file("./cookies.txt", remote_path="/root/cookies.txt")
        )


app = modal.App("omen-clipper", image=image)

volume = modal.Volume.from_name("omen-clipper-model-cache", create_if_missing=True)

mount_path = "/root/.cache/torch"

auth_scheme = HTTPBearer()

def create_potrait_vid(tracks, scores, pyframes_path, pyavi_path, audio_path, output_path, framerate=25):
    target_width = 1080
    target_height = 1920
    
    flist =  glob.glob(os.path.join(pyframes_path, "*.jpg"))
    flist.sort()
    
    faces = [[] for _ in range(len(flist))]
    
    for tidx, track in enumerate(tracks):
        score_array = scores[tidx]
        for fidx, frame in enumerate(track["track"]["frame"].tolist()):
            slice_start = max(fidx - 30, 0)
            slice_end = max(fidx + 30, len(score_array))
            score_slice = score_array[slice_start:slice_end]
            avg_score = float(np.mean(score_slice) if len(score_slice) > 0 else 0)
            
            faces[frame].append({"track": tidx, "score": avg_score, "s": track["proc_track"]["s"][fidx], "x": track["proc_track"]["x"][fidx], "y": track["proc_track"]["y"][fidx]})
            
    temp_vid_path = os.path.join(pyavi_path, "video_only.mp4")
    
    vout = None
    
    for fidx, fname in tqdm(enumerate(flist), total=len(flist), desc = "Creating potrait vid"):
        img = cv2.imread(fname)
        if img is None:
            continue
        
        current_faces = faces[fidx]
        
        max_score_face = max(current_faces, key=lambda face:face['score']) if current_faces else None
        
        if max_score_face and max_score_face['score'] < 0:
            max_score_face = None
            
        if vout is None:
            vout = ffmpegcv.VideoWriterNV(file=temp_vid_path, codec=None, fps=framerate, resize=(target_width, target_height))
            
        if max_score_face:
            mode = "crop"
        else:
            mode = "resize"
            
        if mode == "resize":
            scale = target_width / img.shape[1]
            resized_height = int(img.shape[0] * scale)
            resized_img = cv2.resize(img, (target_width, resized_height), interpolation=cv2.INTER_AREA)
            scale_bg = max(target_width/img.shape[1], target_height/img.shape[0])
            
            bg_width = int(img.shape[1] * scale_bg)
            bg_height = int(img.shape[0] * scale_bg)
            
            blur_bg = cv2.resize(img, (bg_width, bg_height))
            
            blur_bg = cv2.GaussianBlur(blur_bg, (121, 121), 0)
            
            crop_x = (bg_width - target_width) // 2
            crop_y = (bg_height - target_height) // 2
            
            blur_bg = blur_bg[crop_y:crop_y + target_height, crop_x:crop_x + target_width]
            overlay_y = max((target_height - resized_height) // 2, 0)
            frame = blur_bg.copy()
            frame[overlay_y:overlay_y + resized_height, :] = resized_img

            vout.write(frame)
            # vout.write(blur_bg)
            
        elif mode == "crop":
            scale = target_height / img.shape[0]
            
            resized_img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            frame_width = resized_img.shape[1]
            center_x = int(max_score_face["x"] * scale if max_score_face else frame_width // 2)
            left_x = max(min(center_x - target_width // 2, frame_width - target_width), 0)
            
            cropped_img = resized_img[0:target_height, left_x:left_x+target_width]
            
            vout.write(cropped_img)
            
    if vout:
        vout.release()
        
    stitch_audio_cmd = (f"ffmpeg -y -i {temp_vid_path} -i {audio_path} " f"-c:v h264 -preset fast -crf 23 -c:a aac -b:a 128k " f"{output_path}")
    
    subprocess.run(stitch_audio_cmd, shell=True, check=True, text=True)
            
def burn_subtitles(transcript: list, clip_start: float, clip_end: float, clip_video_path: str, output_path: str, max_words: int = 5):
    temp_dir = os.path.dirname(output_path)
    subtitle_path = os.path.join(temp_dir, "temp_subtitles.ass")
    
    clip_segements = [segment for segment in transcript
                        if segment.get("start") is not None
                        and segment.get("end") is not None
                        and segment.get("end") > clip_start
                        and segment.get("start") < clip_end
                    ]
    subtitles = []
    current_words = []
    
    current_start = None
    current_end = None
    
    print(f"[DEBUG] Transcript has {len(transcript)} segments")
    print(f"[DEBUG] Filtered transcript has {len(clip_segements)} segments for clip {clip_start:.2f}s-{clip_end:.2f}s")
    
    for segment in clip_segements:
        word = segment.get("word", "").strip()
        seg_start = segment.get("start")
        seg_end = segment.get("end")
        
        if not word or seg_start is None or seg_end is None:
            continue
        
        start_rel = max(0.0, seg_start - clip_start)
        end_rel =  max(0.0, seg_end - clip_start)
        
        if end_rel <= 0:
            continue
        
        if not current_words:
            current_start = start_rel
            current_end = end_rel
            current_words = [word]
        elif len(current_words) >= max_words:
            subtitles.append((current_start, current_end, ' '.join(current_words)))
            current_words = [word]
            current_start = start_rel
            current_end = end_rel
        else:
            current_words.append(word)
            current_end = end_rel
            
    if current_words:
        subtitles.append((current_start, current_end, ' '.join(current_words)))
    
    print(f"[DEBUG] Created {len(subtitles)} subtitle lines")
    
    subs = pysubs2.SSAFile()
    
    subs.info["WrapStyle"] = 0
    subs.info["ScaledBorderAndShadow"] = "yes"
    subs.info["PlayResX"] = 1080
    subs.info["PlayResY"] = 1920
    subs.info["ScriptType"] = "v4.00+"
    
    style_name = "Default"
    new_style = pysubs2.SSAStyle()
    new_style.fontname = "Anton"
    new_style.fontsize = 140
    new_style.primarycolor = pysubs2.Color(255, 255, 255)
    new_style.outline = 2.0
    new_style.shadow = 2.0
    new_style.shadowcolor = pysubs2.Color(0,0,0,128)
    new_style.alignment = 2
    new_style.marginl = 50
    new_style.marginr = 50
    new_style.marginv = 50
    new_style.spacing = 0.0
    
    subs.styles[style_name] = new_style
    
    for i, (start, end, text) in enumerate(subtitles):
        start_time = pysubs2.make_time(s=start)
        end_time = pysubs2.make_time(s=end)
        line = pysubs2.SSAEvent(start=start_time, end=end_time, text=text, style=style_name)
        subs.events.append(line)
    
    subs.save(subtitle_path)
    
    ffmpeg_cmd = (f"ffmpeg -y -i {clip_video_path} -vf \"ass={subtitle_path}\" " f"-c:v h264 -preset fast -crf 23 {output_path}")
    
    subprocess.run(ffmpeg_cmd, shell=True, check=True)
        
  
def process_segment(base_dir: str, segment_video_path: str, uuid: str, clip_index: int, transcript: list):
    """Process a pre-segmented video clip (no time cutting needed)"""
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
    
    pyframes_path.mkdir(exist_ok=True)
    pyavi_path.mkdir(exist_ok=True)
    
    # Extract audio from segment
    extract_audio_cmd = f"ffmpeg -i {segment_video_path} -vn -acodec pcm_s16le -ar 16000 -ac 1 {audio_path}"
    subprocess.run(extract_audio_cmd, shell=True, check=True, capture_output=True, text=True)
    
    # Copy segment to base directory for Columbia processing
    shutil.copy(segment_video_path, base_dir / f"{clip_name}.mp4")
    
    # Run Columbia ASD
    columbia_command = (f"python Columbia_test.py --videoName {clip_name} " 
                       f"--videoFolder {str(base_dir)} " 
                       f"--pretrainModel weight/finetuning_TalkSet.model")
    columbia_start_time = time.time()
    subprocess.run(columbia_command, cwd="/asd", shell=True)
    columbia_end_time = time.time()
    
    print(f"Columbia ASD complete in {columbia_end_time - columbia_start_time:.2f} s")
    
    # Load tracks and scores
    tracks_path = clip_dir / "pywork" / "tracks.pckl"
    scores_path = clip_dir / "pywork" / "scores.pckl"
    if not tracks_path.exists() or not scores_path.exists():
        raise FileNotFoundError("Tracks or scores not found")
    
    with open(tracks_path, "rb") as f:
        tracks = pickle.load(f)

    with open(scores_path, "rb") as f:
        scores = pickle.load(f)
        
    # Create portrait video
    portrait_start_time = time.time()   
    create_potrait_vid(tracks, scores, pyframes_path, pyavi_path, audio_path, vertical_mp4_path)
    portrait_end_time = time.time()   
    
    print(f"Portrait video creation time: {portrait_end_time - portrait_start_time:.2f} s")
    
    # Burn subtitles using the provided transcript subset
    # Get video duration
    result = subprocess.run(
        f"ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 {segment_video_path}",
        shell=True, capture_output=True, text=True
    )
    duration = float(result.stdout.strip()) if result.stdout.strip() else 60.0
    
    # Use the existing burn_subtitles function with the provided transcript
    burn_subtitles(transcript, 0, duration, vertical_mp4_path, subtitle_output_path, max_words=5)
    
    # Upload to S3
    s3_client = boto3.client("s3")
    s3_client.upload_file(subtitle_output_path, "omenclip", output_s3_key)
    
    print(f"Segment {clip_index} uploaded to S3: {output_s3_key}")

def filter_transcript_by_time(transcript: list, start_time: float, end_time: float) -> list:
    """Filter transcript to only include words within the specified time range"""
    filtered = []
    for word_segment in transcript:
        if (word_segment.get("start") is not None and 
            word_segment.get("end") is not None and
            word_segment.get("start") < end_time and 
            word_segment.get("end") > start_time):
            # Adjust timestamps to be relative to segment start
            adjusted_segment = word_segment.copy()
            adjusted_segment["start"] = max(0, word_segment["start"] - start_time)
            adjusted_segment["end"] = max(0, word_segment["end"] - start_time)
            filtered.append(adjusted_segment)
    return filtered

def process_clip(base_dir: str, original_video_path: str, uuid_or_s3_key: str, start_time:float, end_time:float, clip_index: int, transcript:list, is_uuid: bool = False):
    clip_name = f"clip_{clip_index}"
    
    if is_uuid:
        # For YouTube downloads, use uuid-based structure
        output_s3_key = f"{uuid_or_s3_key}/clip_{clip_index}.mp4"
    else:
        # For S3 key inputs, use existing logic
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
    
    pyframes_path.mkdir(exist_ok=True)
    pyavi_path.mkdir(exist_ok=True)
    
    duration = end_time - start_time
    
    cut_command = (f"ffmpeg -i {original_video_path} -ss {start_time} -t {duration} " f"{clip_segment_path}")
    
    subprocess.run(cut_command, shell=True, check=True, capture_output=True, text=True)
    
    extract_audio_cmd = f"ffmpeg -i {clip_segment_path} -vn -acodec pcm_s16le -ar 16000 -ac 1 {audio_path}"
    
    subprocess.run(extract_audio_cmd, shell=True, check=True, capture_output=True, text=True)
    
    shutil.copy(clip_segment_path, base_dir / f"{clip_name}.mp4")
    
    columbia_command = (f"python Columbia_test.py --videoName {clip_name} " f"--videoFolder {str(base_dir)} " f"--pretrainModel weight/finetuning_TalkSet.model")
    columbia_start_time = time.time()
    subprocess.run(columbia_command, cwd="/asd", shell=True)
    
    columbia_end_time = time.time()
    
    print(f"Col. script complete in {columbia_end_time - columbia_start_time:.2f} s")
    
    tracks_path = clip_dir / "pywork" / "tracks.pckl"
    scores_path = clip_dir / "pywork" / "scores.pckl"
    if not tracks_path.exists() or not scores_path.exists():
        raise FileNotFoundError("Tracks or scroes not found")
    
    with open(tracks_path, "rb") as f:
        tracks = pickle.load(f)

    with open(scores_path, "rb") as f:
        scores = pickle.load(f)
        
    potrait_start_time = time.time()   
        
    create_potrait_vid(tracks, scores, pyframes_path, pyavi_path, audio_path, vertical_mp4_path)
    
    potrait_end_time = time.time()   
    
    print(f"Clip {clip_index} potrait video creation time: {potrait_end_time - potrait_start_time:.2f} s")
    
    burn_subtitles(transcript, start_time, end_time, vertical_mp4_path, subtitle_output_path, max_words=5)
    
    s3_client = boto3.client("s3")
    s3_client.upload_file(subtitle_output_path, "omenclip", output_s3_key)

@app.cls(gpu="L40S", timeout=3600, retries=0, scaledown_window=20, secrets=[modal.Secret.from_name("omen-clipper-secret")], volumes={mount_path: volume})
class OmenClipper:
    @modal.enter()
    def load_model(self):
        self.whisperx_model = whisperx.load_model("large-v2", device="cuda", compute_type="float16")
        self.alignment_model, self.metadata = whisperx.load_align_model(
            language_code="en",
            device="cuda"
        )
        
        self.openai_client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
        
        self.gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        
        print("Transcription models loaded...")
    
    def download_youtube_video(self, youtube_url: str, output_path: str, start_time: float = None, end_time: float = None) -> bool:
        """
        Download a YouTube video using yt-dlp, optionally specifying a time range.
        """
        try:
            temp_dir = os.path.dirname(output_path)
            temp_file = os.path.join(temp_dir, f"temp_full_video_{uuid.uuid4().hex}.mp4")

            # Base yt-dlp command
            command = [
                "yt-dlp",
                "--no-warnings",
                "--merge-output-format", "mp4",
                "-f", "bv*+ba/best",
                "--cookies", "/root/cookies.txt",
                "-o", temp_file,
            ]

            # Add time range support
            if start_time is not None or end_time is not None:
                section = f"*{start_time or 0}-{end_time}" if end_time else f"*{start_time}-"
                command += ["--download-sections", section]

            command.append(youtube_url)

            print(f"[INFO] Running command: {' '.join(command)}")
            subprocess.run(command, check=True, capture_output=True, text=True)

            # If we downloaded the segment directly
            if start_time or end_time:
                if os.path.exists(temp_file):
                    os.rename(temp_file, output_path)
            else:
                # Otherwise just use full video
                os.rename(temp_file, output_path)

            if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
                print("[ERROR] Download failed or empty output.")
                return False

            print(f"[INFO] Download complete: {output_path}")
            return True

        except subprocess.CalledProcessError as e:
            print("[ERROR] yt-dlp failed:", e.stderr)
            return False
        except Exception as e:
            print(f"[ERROR] Exception during download: {str(e)}")
            return False

    
    def upload_to_s3(self, file_path: str, bucket_name: str, s3_key: str) -> bool:
        """
        Upload a file to S3 bucket
        """
        try:
            s3_client = boto3.client("s3")
            s3_client.upload_file(file_path, bucket_name, s3_key)
            print(f"Successfully uploaded {file_path} to s3://{bucket_name}/{s3_key}")
            return True
        except Exception as e:
            print(f"Failed to upload to S3: {str(e)}")
            return False
    
    def transcription(self, base_dir: str, video_path: str)-> str:
        audio_path = base_dir / "audio.wav"
        extract_cmd = f"ffmpeg -i {video_path} -vn -acodec pcm_s16le -ar 16000 -ac 1 {audio_path}"
        subprocess.run(extract_cmd, shell=True, check=True, capture_output=True)
        
        print("starting transcription with WhisperX...")
        start_time = time.time()
        audio = whisperx.load_audio(str(audio_path))
        result = self.whisperx_model.transcribe(audio, batch_size=16)
        result = whisperx.align(result["segments"], self.alignment_model, self.metadata, audio, device="cuda", return_char_alignments=False)
        duration = time.time() - start_time
        
        print("Transcription took", str(duration))
        
        segments = []
        if "word_segments" in result:
            for word_segment in result["word_segments"]:
                segments.append({
                    "start": word_segment["start"],
                    "end": word_segment["end"],
                    "word": word_segment["word"]
                })
                
        return json.dumps(segments)
    
    def transcribe_audio_file(self, audio_s3_key: str) -> str:
        """
        Transcribe an audio file directly from S3 using WhisperX
        """
        run_id = str(uuid.uuid4())
        temp_dir = pathlib.Path("/tmp") / f"audio_transcription_{run_id}"
        temp_dir.mkdir(parents=True, exist_ok=True)
        
        try:
            # Download audio file from S3
            audio_path = temp_dir / "audio_file"
            s3_client = boto3.client("s3")
            s3_client.download_file("omenclip", audio_s3_key, str(audio_path))
            
            # Convert to WAV format for WhisperX if needed
            wav_path = temp_dir / "audio.wav"
            convert_cmd = f"ffmpeg -i {audio_path} -vn -acodec pcm_s16le -ar 16000 -ac 1 {wav_path}"
            subprocess.run(convert_cmd, shell=True, check=True, capture_output=True)
            
            print("Starting transcription with WhisperX...")
            start_time = time.time()
            audio = whisperx.load_audio(str(wav_path))
            result = self.whisperx_model.transcribe(audio, batch_size=16)
            result = whisperx.align(result["segments"], self.alignment_model, self.metadata, audio, device="cuda", return_char_alignments=False)
            duration = time.time() - start_time
            
            print(f"Audio transcription took {duration:.2f} seconds")
            
            segments = []
            if "word_segments" in result:
                for word_segment in result["word_segments"]:
                    segments.append({
                        "start": word_segment["start"],
                        "end": word_segment["end"],
                        "word": word_segment["word"]
                    })
            
            return json.dumps(segments)
            
        finally:
            # Clean up temporary files
            if temp_dir.exists():
                shutil.rmtree(temp_dir, ignore_errors=True)
    
    def identify_viral_moments(self, transcript: dict):
        response = self.gemini_client.models.generate_content(model="gemini-2.5-flash-preview-04-17", contents="""You are given a transcript of a podcast video, where each word includes its start and end time in seconds. Your goal is to extract question-answer clips from this transcript.

Extraction Criteria:

Each clip must:
- Be between 30 and 60 seconds long, ideally 40–60 seconds, but 30–39 seconds is allowed if it's a complete Q&A.
- Start with the question and end with the complete answer.
- Optionally include a few extra sentences before the question if they provide helpful context.
- Be non-overlapping with any other clip.
- Begin and end only at sentence boundaries, matching the given word timestamps.
- Use only the provided start and end timestamps — do not modify or generate new timestamps.

Exclude:
- Greetings ("Hi", "Thanks for joining", etc.)
- Farewells ("Goodbye", "See you next time", etc.)
- General chit-chat or filler not part of a clear Q&A or story

Output Format (Must be valid for json.loads in Python):

Return a list of JSON objects, each representing a clip:

[{"start": seconds, "end": seconds}, ...clip2, clip3]

- "start" and "end" must use only the timestamps from the transcript.
- Aim to extract 40–60s clips where possible.
- Do not include any extra metadata or output — only the JSON list.
- You must always return atleast 1 clip.

If no valid clips are found:

Return exactly:
[]

    The transcript is as follows:\n\n""" + str(transcript))
        
        return response.text
        
    
    @modal.fastapi_endpoint(method="POST")
    def process_video(self, request: ProcessVideoRequest, token: HTTPAuthorizationCredentials = Depends(auth_scheme)):
        if token.credentials != os.environ["AUTH_TOKEN"]:
            raise HTTPException(status_code=Status.HTTP_401_UNAUTHORIZED, detail="Incorrect bearer token", headers={"WWW-Authenticate": "Bearer"})
        
        run_id = str(uuid.uuid4())
        base_dir = pathlib.Path("/tmp") / run_id
        base_dir.mkdir(parents=True, exist_ok=True)
        
        video_path = base_dir / "input_video.mp4"
        
        # Handle YouTube URL if provided
        if request.youtube_url:
            print(f"Processing YouTube URL: {request.youtube_url}")
            
            # UUID is required for YouTube URLs
            if not request.uuid:
                raise HTTPException(status_code=400, detail="UUID is required when processing YouTube URLs")
            
            # Download the YouTube video
            download_success = self.download_youtube_video(
                request.youtube_url, 
                str(video_path), 
                start_time=request.start_time,
                end_time=request.end_time
            )
            
            if not download_success:
                raise HTTPException(status_code=500, detail="Failed to download YouTube video")
            
            # Use UUID-based S3 key structure
            s3_key = f"{request.uuid}/original.mp4"
            
            # Upload the video to S3
            upload_success = self.upload_to_s3(str(video_path), "omenclip", s3_key)
            
            if not upload_success:
                raise HTTPException(status_code=500, detail="Failed to upload video to S3")
                
        # Handle S3 key if provided
        elif request.s3_key:
            print("Trying to download S3 key:", request.s3_key)
            s3_key = request.s3_key
            
            # Download the video from S3
            s3_client = boto3.client("s3")
            s3_client.download_file("omenclip", s3_key, str(video_path))
        else:
            raise HTTPException(status_code=400, detail="Either youtube_url or s3_key must be provided")
        
        # Continue with existing processing
        transcript_json = self.transcription(base_dir, video_path)
        
        transcript = json.loads(transcript_json)
        
        print("identifying..")
        identified_moments = self.identify_viral_moments(transcript)
        
        clean_json_string = identified_moments.strip()
        if clean_json_string.startswith("```json"):
            clean_json_string = clean_json_string[len("```json"):].strip()
        if clean_json_string.endswith("```"):
            clean_json_string = clean_json_string[:-len("```")].strip()

        clip_moments = json.loads(clean_json_string)
        if not isinstance(clip_moments, list):
            print("Error")
            clip_moments=[]
        
        print(clip_moments)
        
        # Determine if we're using UUID-based structure (YouTube) or S3 key structure
        is_youtube_processing = request.youtube_url is not None
        uuid_or_s3_key = request.uuid if is_youtube_processing else s3_key
        
        def process_single_clip(clip_data):
            """Process a single clip - used for concurrent execution"""
            index, moment = clip_data
            
            try:
                if "start" in moment and "end" in moment:
                    print(f"Processing clip {index} from {moment['start']} to {moment['end']}")
                    process_clip(base_dir, video_path, uuid_or_s3_key, moment["start"], moment["end"], index, transcript, is_uuid=is_youtube_processing)
                    
                    processed_clip = {
                        "index": index,
                        "start_time": moment["start"],
                        "end_time": moment["end"]
                    }
                    
                    print(f"Successfully processed clip {index}")
                    return processed_clip
                else:
                    print(f"Skipping clip {index} - missing start or end time")
                    return None
                    
            except Exception as e:
                print(f"Error processing clip {index}: {str(e)}")
                raise Exception(f"Failed to process clip {index}: {str(e)}")
        
        # Process clips in parallel with max 2 workers
        processed_clips = []
        clip_data_list = list(enumerate(clip_moments[:5]))
        
        if clip_data_list:
            print(f"Starting concurrent processing of {len(clip_data_list)} clips with max 2 workers...")
            
            with ThreadPoolExecutor(max_workers=2) as executor:
                # Submit all clips for processing
                future_to_clip = {
                    executor.submit(process_single_clip, clip_data): clip_data[0] 
                    for clip_data in clip_data_list
                }
                
                # Collect results as they complete
                for future in as_completed(future_to_clip):
                    clip_index = future_to_clip[future]
                    try:
                        processed_clip = future.result()
                        if processed_clip:
                            processed_clips.append(processed_clip)
                        print(f"Completed clip {clip_index}")
                    except Exception as e:
                        print(f"Clip {clip_index} failed with error: {str(e)}")
                        # Continue processing other clips even if one fails
                        pass
            
            # Sort processed clips by index to maintain order
            processed_clips.sort(key=lambda x: x["index"])
        
        if base_dir.exists():
            print(f"Cleaning up temp dir {base_dir}")
            shutil.rmtree(base_dir, ignore_errors=True)
            
        return {"success": True, "clip_count": len(processed_clips), "processed_clips": processed_clips, "run_id": run_id}

    @modal.fastapi_endpoint(method="POST")
    def transcribe_audio(self, request: TranscribeAudioRequest, token: HTTPAuthorizationCredentials = Depends(auth_scheme)):
        """
        Transcribe an audio file from S3 and return the transcript
        """
        if token.credentials != os.environ["AUTH_TOKEN"]:
            raise HTTPException(status_code=Status.HTTP_401_UNAUTHORIZED, detail="Incorrect bearer token", headers={"WWW-Authenticate": "Bearer"})
        
        try:
            print(f"Transcribing audio file: {request.s3_key}")
            transcript_json = self.transcribe_audio_file(request.s3_key)
            transcript = json.loads(transcript_json)
            
            return {
                "success": True, 
                "transcript": transcript,
                "word_count": len(transcript)
            }
            
        except Exception as e:
            print(f"Error transcribing audio: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to transcribe audio: {str(e)}")

    @modal.fastapi_endpoint(method="POST")
    def process_segments(self, request: ProcessSegmentsRequest, token: HTTPAuthorizationCredentials = Depends(auth_scheme)):
        """
        Process pre-segmented video clips using provided transcript - create portrait videos, burn subtitles
        """
        if token.credentials != os.environ["AUTH_TOKEN"]:
            raise HTTPException(status_code=Status.HTTP_401_UNAUTHORIZED, detail="Incorrect bearer token", headers={"WWW-Authenticate": "Bearer"})
        
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
            
            # Download the full transcript from S3 once
            print(f"Downloading full transcript from: {request.transcript_s3_key}")
            transcript_path = base_dir / "full_transcript.json"
            s3_client = boto3.client("s3")
            s3_client.download_file("omenclip", request.transcript_s3_key, str(transcript_path))
            
            with open(transcript_path, 'r') as f:
                full_transcript = json.load(f)
            
            print(f"Full transcript loaded with {len(full_transcript)} words")
            
            def process_single_segment(segment_data):
                """Process a single segment - used for concurrent execution"""
                index, segment_info = segment_data
                
                try:
                    print(f"Processing segment {index}: {segment_info.s3_key} ({segment_info.start_time}s-{segment_info.end_time}s)")
                    
                    # Create thread-safe S3 client for this segment
                    thread_s3_client = boto3.client("s3")
                    
                    # Download segment from S3
                    segment_path = base_dir / f"segment_{index}.mp4"
                    thread_s3_client.download_file("omenclip", segment_info.s3_key, str(segment_path))
                    
                    # Filter transcript for this segment
                    print(f"Filtering transcript for segment {index}...")
                    segment_transcript = filter_transcript_by_time(
                        full_transcript, 
                        segment_info.start_time, 
                        segment_info.end_time
                    )
                    
                    print(f"Segment {index} transcript filtered to {len(segment_transcript)} words")
                    
                    # Process the segment (create portrait video, burn subtitles, upload)
                    print(f"Processing segment {index} into portrait video...")
                    process_segment(base_dir, segment_path, request.uuid, index, segment_transcript)
                    
                    processed_clip = {
                        "index": index,
                        "original_s3_key": segment_info.s3_key,
                        "output_s3_key": f"{request.uuid}/clip_{index}.mp4",
                        "start_time": segment_info.start_time,
                        "end_time": segment_info.end_time
                    }
                    
                    print(f"Successfully processed segment {index}")
                    return processed_clip
                    
                except Exception as e:
                    print(f"Error processing segment {index}: {str(e)}")
                    raise Exception(f"Failed to process segment {index}: {str(e)}")
            
            # Use ThreadPoolExecutor to process segments with limited concurrency
            processed_clips = []
            segment_data_list = list(enumerate(request.segments))
            
            print(f"Starting concurrent processing with max 2 workers...")
            
            with ThreadPoolExecutor(max_workers=2) as executor:
                # Submit all segments for processing
                future_to_segment = {
                    executor.submit(process_single_segment, segment_data): segment_data[0] 
                    for segment_data in segment_data_list
                }
                
                # Collect results as they complete
                for future in as_completed(future_to_segment):
                    segment_index = future_to_segment[future]
                    try:
                        processed_clip = future.result()
                        processed_clips.append(processed_clip)
                        print(f"Completed segment {segment_index}")
                    except Exception as e:
                        print(f"Segment {segment_index} failed with error: {str(e)}")
                        raise e
            
            # Sort processed clips by index to maintain order
            processed_clips.sort(key=lambda x: x["index"])
            
            print(f"All segments processed successfully!")
            
            return {
                "success": True,
                "clip_count": len(processed_clips),
                "processed_clips": processed_clips,
                "uuid": request.uuid
            }
            
        except Exception as e:
            print(f"Error processing segments: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to process segments: {str(e)}")
            
        finally:
            # Clean up temporary files
            if base_dir.exists():
                print(f"Cleaning up temp dir {base_dir}")
                shutil.rmtree(base_dir, ignore_errors=True)

@app.local_entrypoint()
def main():
    import requests
    
    omen_clipper = OmenClipper()
    
    url = omen_clipper.process_video.web_url
    
    # Example of using a YouTube URL with time range
    payload={
        "youtube_url": "https://www.youtube.com/watch?v=zmIiH9tLwX8",
        "uuid": "010882aa-c6ee-4b10-9ee9-03fba1199eff",  # Required for YouTube URLs
        # "start_time": 60,   # Start 60 seconds in
        # "end_time": 300     # End at 300 seconds (4 minute clip)
    #     # Alternatively, you can use an S3 key (no uuid needed)
    #     "s3_key": "test1/input3med.mp4"
    }
    
    # Example of using the audio transcription endpoint:
    audio_url = omen_clipper.transcribe_audio.web_url
    audio_payload = {
        "s3_key": "test1/convert.wav"  # or .wav, .m4a, etc.
    }
    # audio_response = requests.post(audio_url, json=audio_payload, headers=headers)
    # audio_result = audio_response.json()
    # print(f"Transcript: {audio_result}")
    
    # Example of using the process segments endpoint:
    # segments_url = omen_clipper.process_segments.web_url
    # segments_payload = {
    #     "segments": [
    #     {
    #         "start_time": 179.733,
    #         "end_time": 212.223,
    #         "s3_key": "010882aa-c6ee-4b10-9ee9-03fba1199eff/segment_0.mp4"
    #     },
    #     {
    #         "start_time": 346.711,
    #         "end_time": 392.918,
    #         "s3_key": "010882aa-c6ee-4b10-9ee9-03fba1199eff/segment_1.mp4"
    #     },
    #     {
    #         "start_time": 438.508,
    #         "end_time": 470.25,
    #         "s3_key": "010882aa-c6ee-4b10-9ee9-03fba1199eff/segment_2.mp4"
    #     },
    #     {
    #         "start_time": 699.635,
    #         "end_time": 758.867,
    #         "s3_key": "010882aa-c6ee-4b10-9ee9-03fba1199eff/segment_3.mp4"
    #     }
    # ],
    #     "uuid": "010882aa-c6ee-4b10-9ee9-03fba1199eff",
    #     "transcript_s3_key": "010882aa-c6ee-4b10-9ee9-03fba1199eff/transcript.json"
    # }
    # segments_response = requests.post(segments_url, json=segments_payload, headers=headers)
    # segments_result = segments_response.json()
    # print(f"Processed segments: {segments_result}")
    
    # Test with only start time
    # payload={
    #     "youtube_url": "https://www.youtube.com/watch?v=oFfVt3S51T4",
    #     "start_time": 120   # Start 2 minutes in, continue to end
    # }
    
    # Test with only end time
    # payload={
    #     "youtube_url": "https://www.youtube.com/watch?v=oFfVt3S51T4",
    #     "end_time": 60      # Take just the first minute
    # }
    
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer 136048"
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