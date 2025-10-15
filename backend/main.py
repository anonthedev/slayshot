from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
import json
import os
import pathlib
import pickle
import random
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


class ProcessVideoRequest(BaseModel):
    s3_key: str | None = None
    youtube_url: str | None = None
    uuid: str | None = None  # UUID for organizing files in S3 (required for YouTube URLs)
    start_time: float | None = None  # Start time in seconds (optional)
    end_time: float | None = None  # End time in seconds (optional)
    layout: str | None = "full"  # "full" for full screen, "split" for top-half video with bottom gameplay
    bait_video: str | None = "minecraft_night"  # gameplay asset key name under gameplay/

class TranscribeAudioRequest(BaseModel):
    s3_key: str  # S3 key pointing to the audio file

class SegmentInfo(BaseModel):
    s3_key: str  # S3 key for the video segment
    start_time: float  # Start time in seconds
    end_time: float  # End time in seconds
    virality_score: int | None = None  # Virality score from 1-10

class ProcessSegmentsRequest(BaseModel):
    segments: list[SegmentInfo]  # Array of segment info with S3 keys and timings
    uuid: str  # UUID for organizing output clips in S3
    transcript_s3_key: str  # S3 key for the full transcript JSON file
    layout: str | None = "full"  # "full" for full screen, "split" for top-half video with bottom gameplay
    bait_video: str | None = "minecraft_night"  # gameplay asset key name under gameplay/

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
            .run_commands([
             "mkdir -p /usr/share/fonts/truetype/custom", 
             "wget -O /usr/share/fonts/truetype/custom/Montserrat-Bold.ttf https://github.com/JulietaUla/Montserrat/raw/refs/heads/master/fonts/ttf/Montserrat-Bold.ttf", 
             "fc-cache -f -v"
            ])
            .run_commands([
             "pip install -U yt-dlp"
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
            
# NEW: top-half composition variant for b-roll (with optional bottom gameplay fill)

def create_potrait_vid_top_half(tracks, scores, pyframes_path, pyavi_path, audio_path, output_path, framerate=25, bottom_video_path: str | None = None, clip_duration: float | None = None):
    target_width = 1080
    target_height = 1920
    top_height = target_height // 2  # 960
    bottom_height = target_height - top_height  # 960

    flist = glob.glob(os.path.join(pyframes_path, "*.jpg"))
    flist.sort()

    faces = [[] for _ in range(len(flist))]

    for tidx, track in enumerate(tracks):
        score_array = scores[tidx]
        for fidx, frame in enumerate(track["track"]["frame"].tolist()):
            slice_start = max(fidx - 30, 0)
            slice_end = max(fidx + 30, len(score_array))
            score_slice = score_array[slice_start:slice_end]
            avg_score = float(np.mean(score_slice) if len(score_slice) > 0 else 0)

            faces[frame].append({
                "track": tidx,
                "score": avg_score,
                "s": track["proc_track"]["s"][fidx],
                "x": track["proc_track"]["x"][fidx],
                "y": track["proc_track"]["y"][fidx]
            })

    temp_vid_path = os.path.join(pyavi_path, "video_only_top_half.mp4")

    vout = None

    bait_cap = None
    bait_frame_count = 0
    bait_fps = 25.0
    bait_current_frame = 0
    bait_start_frame = 0
    bait_end_frame = 0
    
    if bottom_video_path and os.path.exists(bottom_video_path):
        print(f"[DEBUG] Initializing bait video from: {bottom_video_path}")
        bait_cap = cv2.VideoCapture(str(bottom_video_path))
        if bait_cap.isOpened():
            bait_frame_count = int(bait_cap.get(cv2.CAP_PROP_FRAME_COUNT))
            bait_fps = bait_cap.get(cv2.CAP_PROP_FPS) or 25.0
            bait_duration = bait_frame_count / bait_fps
            
            # Calculate required frames for clip with margin
            required_duration = clip_duration or 60.0  # Default to 60 seconds if not provided
            margin_duration = 5.0  # 5 second margin
            required_frames = int((required_duration + margin_duration) * bait_fps)
            
            if bait_frame_count > required_frames:
                # Randomize start position ensuring we have enough frames
                max_start_frame = bait_frame_count - required_frames
                bait_start_frame = random.randint(0, max_start_frame)
                bait_end_frame = bait_start_frame + required_frames
                print(f"[DEBUG] Randomized bait video segment: frames {bait_start_frame}-{bait_end_frame} (duration: {required_frames/bait_fps:.2f}s)")
            else:
                # If bait video is shorter than needed, use the entire video and loop
                bait_start_frame = 0
                bait_end_frame = bait_frame_count
                print(f"[DEBUG] Bait video shorter than required, using full duration: {bait_duration:.2f}s")
            
            print(f"[DEBUG] Bait video loaded: {bait_frame_count} frames at {bait_fps} fps, total duration: {bait_duration:.2f}s")
        else:
            print(f"[ERROR] Failed to open bait video: {bottom_video_path}")
            bait_cap.release()
            bait_cap = None
    else:
        if bottom_video_path:
            print(f"[ERROR] Bait video file not found: {bottom_video_path}")
        else:
            print("[DEBUG] No bait video provided")

    def read_bait_frame_resized() -> np.ndarray | None:
        nonlocal bait_current_frame
        
        if bait_cap is None or bait_frame_count == 0:
            return None
            
        # Calculate which frame to read within the randomized segment
        available_frames = bait_end_frame - bait_start_frame
        if available_frames <= 0:
            return None
            
        # Calculate relative frame position within the segment
        relative_frame = int(bait_current_frame * bait_fps / framerate) % available_frames
        target_frame = bait_start_frame + relative_frame
        
        bait_cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
        
        ret, frame = bait_cap.read()
        if not ret:
            print(f"[WARNING] Failed to read bait frame {target_frame}, trying start frame {bait_start_frame}")
            bait_cap.set(cv2.CAP_PROP_POS_FRAMES, bait_start_frame)
            ret, frame = bait_cap.read()
            if not ret:
                print("[ERROR] Failed to read any bait frames")
                return None
        
        bait_current_frame += 1
        
        h, w = frame.shape[:2]
        # Scale to cover bottom area fully
        scale = max(target_width / w, bottom_height / h)
        new_w, new_h = int(w * scale), int(h * scale)
        resized = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)
        
        # Center-crop to 1080x960
        x0 = max((new_w - target_width) // 2, 0)
        y0 = max((new_h - bottom_height) // 2, 0)
        cropped = resized[y0:y0 + bottom_height, x0:x0 + target_width]
        
        # Ensure exact dimensions
        if cropped.shape[0] != bottom_height or cropped.shape[1] != target_width:
            canvas = np.zeros((bottom_height, target_width, 3), dtype=np.uint8)
            ch, cw = cropped.shape[:2]
            oy = max((bottom_height - ch) // 2, 0)
            ox = max((target_width - cw) // 2, 0)
            canvas[oy:oy + ch, ox:ox + cw] = cropped
            return canvas
        
        return cropped

    for fidx, fname in tqdm(enumerate(flist), total=len(flist), desc="Creating top-half potrait vid"):
        img = cv2.imread(fname)
        if img is None:
            continue

        current_faces = faces[fidx]
        max_score_face = max(current_faces, key=lambda face: face['score']) if current_faces else None
        if max_score_face and max_score_face['score'] < 0:
            max_score_face = None

        if vout is None:
            vout = ffmpegcv.VideoWriterNV(file=temp_vid_path, codec=None, fps=framerate, resize=(target_width, target_height))

        # Start with a black canvas (bottom half blank by default)
        canvas = np.zeros((target_height, target_width, 3), dtype=np.uint8)

        mode = "crop" if max_score_face else "resize"

        if mode == "crop":
            # Scale so the image height fits the top half
            scale = top_height / img.shape[0]
            resized_img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            frame_width = resized_img.shape[1]
            center_x = int(max_score_face["x"] * scale if max_score_face else frame_width // 2)
            left_x = max(min(center_x - target_width // 2, frame_width - target_width), 0)
            # Crop a 1080x960 window from the resized frame (top area)
            cropped_img = resized_img[0:top_height, left_x:left_x + target_width]
            canvas[0:top_height, 0:target_width] = cropped_img
        else:
            # Resize to width 1080, then letterbox within the 960px top area
            scale = target_width / img.shape[1]
            resized_height = int(img.shape[0] * scale)
            resized_img = cv2.resize(img, (target_width, resized_height), interpolation=cv2.INTER_AREA)

            if resized_height >= top_height:
                # Crop vertically to fit top half
                crop_y = (resized_height - top_height) // 2
                cropped_img = resized_img[crop_y:crop_y + top_height, :]
                canvas[0:top_height, 0:target_width] = cropped_img
            else:
                # Pad vertically within the top half (black bars inside top area)
                overlay_y = (top_height - resized_height) // 2
                canvas[overlay_y:overlay_y + resized_height, 0:target_width] = resized_img

        # Fill bottom half with bait video frame if present (b-roll case)
        bait_frame = read_bait_frame_resized()
        if bait_frame is not None:
            canvas[top_height:target_height, 0:target_width] = bait_frame
            if fidx == 0:  # Debug log for first frame
                print(f"[DEBUG] Successfully composited bait frame into bottom half")
        elif fidx == 0:
            print(f"[DEBUG] No bait frame available, keeping bottom half black")

        vout.write(canvas)

    if vout:
        vout.release()

    if bait_cap is not None:
        bait_cap.release()
        print(f"[DEBUG] Released bait video capture")

    stitch_audio_cmd = (
        f"ffmpeg -y -i {temp_vid_path} -i {audio_path} "
        f"-c:v h264 -preset fast -crf 23 -c:a aac -b:a 128k "
        f"{output_path}"
    )
    subprocess.run(stitch_audio_cmd, shell=True, check=True, text=True)
            

def burn_subtitles(transcript: list, clip_start: float, clip_end: float, clip_video_path: str, output_path: str, max_words: int = 5):
    temp_dir = os.path.dirname(output_path)
    subtitle_path = os.path.join(temp_dir, "temp_subtitles.ass")
    
    clip_segments = [segment for segment in transcript
                     if segment.get("start") is not None
                     and segment.get("end") is not None
                     and segment.get("end") > clip_start
                     and segment.get("start") < clip_end]

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

    # Create subtitle object
    subs = pysubs2.SSAFile()
    subs.info["WrapStyle"] = 0
    subs.info["ScaledBorderAndShadow"] = "yes"
    subs.info["PlayResX"] = 1080
    subs.info["PlayResY"] = 1920
    subs.info["ScriptType"] = "v4.00+"

    # Define normal style
    base_style = pysubs2.SSAStyle()
    base_style.fontname = "Montserrat"
    base_style.fontsize = 100  # Reduced from 140 to prevent 2+ lines
    base_style.primarycolor = pysubs2.Color(255, 255, 255)  # white
    base_style.outline = 2.0
    base_style.shadow = 2.0
    base_style.shadowcolor = pysubs2.Color(0, 0, 0, 128)
    base_style.alignment = 2  # bottom-center
    base_style.marginl = 50
    base_style.marginr = 50
    base_style.marginv = 480
    base_style.spacing = 0.0

    subs.styles["Default"] = base_style

    # Create simple subtitle events that replace each other (no stacking)
    for start, end, word_segments in subtitles:
        # Build the complete text for this subtitle group
        text_parts = []
        for seg in word_segments:
            word = seg["word"].strip()
            if word:
                text_parts.append(word)
        
        if text_parts:
            subtitle_text = " ".join(text_parts)
            
            # Create a single subtitle event for the entire duration
            line = pysubs2.SSAEvent(
                start=pysubs2.make_time(s=start),
                end=pysubs2.make_time(s=end),
                text=subtitle_text,
                style="Default"
            )
            subs.events.append(line)

    # Save ASS file
    subs.save(subtitle_path)

    # Burn subtitles into video using FFmpeg
    ffmpeg_cmd = (
        f"ffmpeg -y -i {clip_video_path} -vf \"ass={subtitle_path}\" "
        f"-c:v h264 -preset fast -crf 23 {output_path}"
    )

    subprocess.run(ffmpeg_cmd, shell=True, check=True)
        
  
def process_segment(base_dir: str, segment_video_path: str, uuid: str, clip_index: int, transcript: list, layout: str = "full", bait_video: str | None = "minecraft_night", virality_score: int | None = None, start_time: float | None = None, end_time: float | None = None):
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
    bait_path = clip_dir / "pyavi" / "bait_video.mp4"
    
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
        
    # If split layout, try to fetch bait gameplay video from S3 into bait_path
    local_bait_path: str | None = None
    if (layout or "full").lower() == "split" and bait_video:
        try:
            bait_key = f"gameplay/{bait_video}.mp4"  # Ensure .mp4 extension
            print(f"Downloading bait gameplay from s3://omenclip/{bait_key} -> {bait_path}")
            s3_client = boto3.client("s3")
            s3_client.download_file("omenclip", bait_key, str(bait_path))
            if bait_path.exists() and bait_path.stat().st_size > 0:
                local_bait_path = str(bait_path)
                print(f"[DEBUG] Bait video downloaded successfully: {local_bait_path} ({bait_path.stat().st_size} bytes)")
            else:
                print("Bait video download resulted in empty file; using blank bottom area")
        except Exception as e:
            print(f"Failed to download bait gameplay video: {e}")
            # Try without .mp4 extension as fallback
            try:
                bait_key = f"gameplay/{bait_video}"
                print(f"Retrying download from s3://omenclip/{bait_key} -> {bait_path}")
                s3_client.download_file("omenclip", bait_key, str(bait_path))
                if bait_path.exists() and bait_path.stat().st_size > 0:
                    local_bait_path = str(bait_path)
                    print(f"[DEBUG] Bait video downloaded successfully on retry: {local_bait_path} ({bait_path.stat().st_size} bytes)")
            except Exception as e2:
                print(f"Fallback download also failed: {e2}")

    # Get video duration for bait video randomization
    result = subprocess.run(
        f"ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 {segment_video_path}",
        shell=True, capture_output=True, text=True
    )
    duration = float(result.stdout.strip()) if result.stdout.strip() else 60.0
    
    # Create portrait video
    portrait_start_time = time.time()   
    if (layout or "full").lower() == "split":
        create_potrait_vid_top_half(tracks, scores, pyframes_path, pyavi_path, audio_path, vertical_mp4_path, bottom_video_path=local_bait_path, clip_duration=duration)
    else:
        create_potrait_vid(tracks, scores, pyframes_path, pyavi_path, audio_path, vertical_mp4_path)
    portrait_end_time = time.time()   
    
    print(f"Portrait video creation time: {portrait_end_time - portrait_start_time:.2f} s")
    
    # Burn subtitles using the provided transcript subset
    
    # Use the existing burn_subtitles function with the provided transcript
    burn_subtitles(transcript, 0, duration, vertical_mp4_path, subtitle_output_path, max_words=5)
    
    # Upload to S3
    s3_client = boto3.client("s3")
    s3_client.upload_file(subtitle_output_path, "omenclip", output_s3_key)
    
    print(f"Segment {clip_index} uploaded to S3: {output_s3_key}")
    
    # Return metadata for this clip (to be collected and written to metadata.json)
    clip_metadata = {
        "clip_index": clip_index,
        "s3_key": output_s3_key,
        "transcript": transcript_to_string(transcript),
        "start_time": start_time,
        "end_time": end_time,
        "virality_score": virality_score
    }
    
    return clip_metadata

def transcript_to_string(transcript: list) -> str:
    """Convert diarized transcript (list of word objects) to a simple string"""
    if not transcript:
        return ""
    
    words = []
    for word_segment in transcript:
        word = word_segment.get("word", "").strip()
        if word:
            words.append(word)
    
    return " ".join(words)

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

def process_clip(base_dir: str, original_video_path: str, uuid_or_s3_key: str, start_time:float, end_time:float, clip_index: int, transcript:list, is_uuid: bool = False, layout: str = "full", bait_video: str | None = "minecraft_night", virality_score: int | None = None):
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
    bait_path = clip_dir / "pyavi" / "bait_video.mp4"
    
    pyframes_path.mkdir(exist_ok=True)
    pyavi_path.mkdir(exist_ok=True)
    
    clip_duration = end_time - start_time
    
    cut_command = (f"ffmpeg -i {original_video_path} -ss {start_time} -t {clip_duration} " f"{clip_segment_path}")
    
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
        
    # If split layout, try to fetch bait gameplay video from S3 into bait_path
    local_bait_path: str | None = None
    if (layout or "full").lower() == "split" and bait_video:
        try:
            bait_key = f"gameplay/{bait_video}.mp4"  # Ensure .mp4 extension
            print(f"Downloading bait gameplay from s3://omenclip/{bait_key} -> {bait_path}")
            s3_client = boto3.client("s3")
            s3_client.download_file("omenclip", bait_key, str(bait_path))
            if bait_path.exists() and bait_path.stat().st_size > 0:
                local_bait_path = str(bait_path)
                print(f"[DEBUG] Bait video downloaded successfully: {local_bait_path} ({bait_path.stat().st_size} bytes)")
            else:
                print("Bait video download resulted in empty file; using blank bottom area")
        except Exception as e:
            print(f"Failed to download bait gameplay video: {e}")
            # Try without .mp4 extension as fallback
            try:
                bait_key = f"gameplay/{bait_video}"
                print(f"Retrying download from s3://omenclip/{bait_key} -> {bait_path}")
                s3_client.download_file("omenclip", bait_key, str(bait_path))
                if bait_path.exists() and bait_path.stat().st_size > 0:
                    local_bait_path = str(bait_path)
                    print(f"[DEBUG] Bait video downloaded successfully on retry: {local_bait_path} ({bait_path.stat().st_size} bytes)")
            except Exception as e2:
                print(f"Fallback download also failed: {e2}")
    
    if (layout or "full").lower() == "split":
        create_potrait_vid_top_half(tracks, scores, pyframes_path, pyavi_path, audio_path, vertical_mp4_path, bottom_video_path=local_bait_path, clip_duration=clip_duration)
    else:
        create_potrait_vid(tracks, scores, pyframes_path, pyavi_path, audio_path, vertical_mp4_path)
    
    potrait_end_time = time.time()   
    
    print(f"Clip {clip_index} potrait video creation time: {potrait_end_time - potrait_start_time:.2f} s")
    
    burn_subtitles(transcript, start_time, end_time, vertical_mp4_path, subtitle_output_path, max_words=5)
    
    s3_client = boto3.client("s3")
    s3_client.upload_file(subtitle_output_path, "omenclip", output_s3_key)
    
    # Return metadata for this clip (to be collected and written to metadata.json)
    clip_metadata = {
        "clip_index": clip_index,
        "s3_key": output_s3_key,
        "transcript": transcript_to_string(transcript),
        "start_time": start_time,
        "end_time": end_time,
        "virality_score": virality_score
    }
    
    return clip_metadata

@app.cls(gpu="L40S", timeout=85000, retries=0, scaledown_window=20, secrets=[modal.Secret.from_name("omen-clipper-secret")], volumes={mount_path: volume})
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

            def seconds_to_hhmmss(seconds):
                return str(timedelta(seconds=int(seconds)))
            
            
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
                start_str = seconds_to_hhmmss(start_time or 0)
                end_str = seconds_to_hhmmss(end_time) if end_time else ''
                section = f"*{start_str}-{end_str}"
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
        prompt = """
You are given a transcript of a video where each word includes its start and end time in seconds. The video may be a podcast (e.g., Lex Fridman style), an interview, a vlog, a monologue, or any content with a speaking person visible on screen. Your task is to extract short, viral-worthy clips from the transcript.

Extraction Criteria:

Each clip must:
- Be 30 to 60 seconds long. Prefer 40–60s, but allow 30–39s if the segment is powerful and self-contained.
- Start and end cleanly at sentence boundaries, using only the provided word-level timestamps — do not invent or adjust timestamps.
- Include complete thoughts — thoughtful answers, memorable questions, emotional insights, rants, jokes, monologues, hot takes, or impactful quotes — even if it's only one speaker.
- Optionally include a few extra sentences before the main moment to provide helpful setup or context.
- Be non-overlapping with other clips — each clip must cover a unique part of the video.
- Use only the exact start and end timestamps from the transcript.

What to Focus On:
- Deep or thought-provoking exchanges (like in Lex Fridman or other podcasts).
- Emotionally powerful moments — vulnerability, intensity, or personal reflection.
- Funny, surprising, or viral-worthy lines.
- Strong opinions, motivational moments, or mic-drop takes.
- Clear and complete Q&A exchanges, especially when the answer is engaging or moving.

Output Format (Must be valid for json.loads in Python):

Return a list of JSON objects, each representing a clip:

[{"start": seconds, "end": seconds, "virality_score": score}, ...clip2, clip3]

- "start" and "end" must use only the timestamps from the transcript.
- "virality_score" must be an integer from 1-10, where 10 is most viral-worthy (extremely engaging, shareable, quotable) and 1 is least viral-worthy (still good but less compelling).
- Aim to extract 40–60s clips where possible.
- Do not include any extra metadata or output — only the JSON list.
- You must always return at least 1 clip. But try to return as many as possible.

Virality Score Guidelines:
- 9-10: Explosive moments, shocking revelations, extremely funny, deeply emotional, or highly quotable
- 7-8: Very engaging content, strong opinions, memorable insights, good humor
- 5-6: Solid content, interesting discussions, moderate engagement potential
- 3-4: Decent content but less compelling, standard conversations
- 1-2: Lowest priority clips, filler content

If no valid clips are found:

Return exactly:
[]

The transcript is as follows:\n\n""" + str(transcript)
        response = self.gemini_client.models.generate_content(model="gemini-2.5-flash",  contents=prompt)
        
        return response.text

        # response = self.openai_client.responses.create(
        #     model="gpt-4o",
        #     input=prompt
        # )
        
        # return response.output_text
        
        
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
        layout_value = (request.layout or "full").lower()
        bait_value = request.bait_video or "minecraft_night"
        
        def process_single_clip(clip_data):
            """Process a single clip - used for concurrent execution"""
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
                        is_uuid=is_youtube_processing, 
                        layout=layout_value, 
                        bait_video=bait_value,
                        virality_score=virality_score
                    )
                    
                    processed_clip = {
                        "index": index,
                        "start_time": moment["start"],
                        "end_time": moment["end"],
                        "virality_score": virality_score,
                        "metadata": clip_metadata
                    }
                    
                    print(f"Successfully processed clip {index}")
                    return processed_clip
                else:
                    print(f"Skipping clip {index} - missing start or end time")
                    return None
                
            except Exception as e:
                print(f"Error processing clip {index}: {str(e)}")
                raise Exception(f"Failed to process clip {index}: {str(e)}")
        
        # Process clips with parallelization (max 2 at once)
        processed_clips = []
        valid_clip_moments = [(index, moment) for index, moment in enumerate(clip_moments) if "start" in moment and "end" in moment]
        
        if valid_clip_moments:
            print(f"Starting concurrent processing of {len(valid_clip_moments)} clips with max 2 workers...")
            
            with ThreadPoolExecutor(max_workers=2) as executor:
                # Submit all clips for processing
                future_to_clip = {
                    executor.submit(process_single_clip, clip_data): clip_data[0] 
                    for clip_data in valid_clip_moments
                }
                
                # Collect results as they complete
                for future in as_completed(future_to_clip):
                    clip_index = future_to_clip[future]
                    try:
                        processed_clip = future.result()
                        if processed_clip:  # Only add if not None (valid clip)
                            processed_clips.append(processed_clip)
                        print(f"Completed clip {clip_index}")
                    except Exception as e:
                        print(f"Clip {clip_index} failed with error: {str(e)}")
                        raise e
            
            # Sort processed clips by index to maintain order
            processed_clips.sort(key=lambda x: x["index"])
            print(f"All clips processed successfully!")
            
            # Generate and upload metadata.json file
            metadata_s3_key = None
            if processed_clips:
                metadata = {
                    "clips": [clip["metadata"] for clip in processed_clips if "metadata" in clip]
                }
                
                # Upload metadata.json to S3
                metadata_path = base_dir / "metadata.json"
                with open(metadata_path, 'w') as f:
                    json.dump(metadata, f, indent=2)
                
                # Determine the correct folder for metadata based on processing type
                if is_youtube_processing:
                    # For YouTube processing, use UUID directly
                    metadata_s3_key = f"{uuid_or_s3_key}/metadata.json"
                else:
                    # For S3 key processing, use the directory part only
                    s3_key_dir = os.path.dirname(uuid_or_s3_key)
                    metadata_s3_key = f"{s3_key_dir}/metadata.json"
                s3_client = boto3.client("s3")
                s3_client.upload_file(str(metadata_path), "omenclip", metadata_s3_key)
                print(f"Metadata uploaded to S3: {metadata_s3_key}")
        
        if base_dir.exists():
            print(f"Cleaning up temp dir {base_dir}")
            shutil.rmtree(base_dir, ignore_errors=True)
            
        return {
            "success": True, 
            "clip_count": len(processed_clips), 
            "run_id": run_id, 
            "processed_clips": processed_clips,
            "metadata_s3_key": metadata_s3_key
        }

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
            
            layout_value = (request.layout or "full").lower()
            bait_value = request.bait_video or "minecraft_night"
            
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
                        end_time=segment_info.end_time
                    )
                    
                    processed_clip = {
                        "index": index,
                        "original_s3_key": segment_info.s3_key,
                        "output_s3_key": f"{request.uuid}/clip_{index}.mp4",
                        "start_time": segment_info.start_time,
                        "end_time": segment_info.end_time,
                        "metadata": clip_metadata
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
            
            # Generate metadata.json file
            metadata = {
                "clips": [clip["metadata"] for clip in processed_clips if "metadata" in clip]
            }
            
            # Upload metadata.json to S3
            metadata_path = base_dir / "metadata.json"
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2)
            
            metadata_s3_key = f"{request.uuid}/metadata.json"
            s3_client.upload_file(str(metadata_path), "omenclip", metadata_s3_key)
            print(f"Metadata uploaded to S3: {metadata_s3_key}")
            
            return {
                "success": True,
                "clip_count": len(processed_clips),
                "processed_clips": processed_clips,
                "metadata_s3_key": metadata_s3_key,
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
        "youtube_url": "https://www.youtube.com/watch?v=wG107SPAs4E",
        "uuid": "010882aa-c6ee-4b10-9ee9-03fba1199eff",
        # "start_time": 0,
        # "end_time": 200,
        "layout": "full",
        # "bait_video": "minecraft_night",

        # "s3_key": "test1/input1.mp4",
        # "layout": "split",
        # "bait_video": "minecraft_night",
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
    #     "transcript_s3_key": "010882aa-c6ee-4b10-9ee9-03fba1199eff/transcript.json",
    #     "layout": "split",
    #     "bait_video": "minecraft_night",
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