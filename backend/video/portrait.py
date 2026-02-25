import glob
import os
import random
import subprocess

import cv2
import ffmpegcv
import numpy as np
from tqdm import tqdm

from config import (
    TARGET_WIDTH,
    TARGET_HEIGHT,
    DEFAULT_CLIP_DURATION,
    BAIT_MARGIN_SECONDS,
)


def create_portrait_vid(
    tracks, scores, pyframes_path, pyavi_path, audio_path, output_path, framerate=25
):
    target_width = TARGET_WIDTH
    target_height = TARGET_HEIGHT

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
                "y": track["proc_track"]["y"][fidx],
            })

    temp_vid_path = os.path.join(pyavi_path, "video_only.mp4")

    vout = None

    for fidx, fname in tqdm(enumerate(flist), total=len(flist), desc="Creating portrait vid"):
        img = cv2.imread(fname)
        if img is None:
            continue

        current_faces = faces[fidx]

        max_score_face = max(current_faces, key=lambda face: face['score']) if current_faces else None

        if max_score_face and max_score_face['score'] < 0:
            max_score_face = None

        if vout is None:
            vout = ffmpegcv.VideoWriterNV(
                file=temp_vid_path, codec=None, fps=framerate,
                resize=(target_width, target_height),
            )

        if max_score_face:
            mode = "crop"
        else:
            mode = "resize"

        if mode == "resize":
            scale = target_width / img.shape[1]
            resized_height = int(img.shape[0] * scale)
            resized_img = cv2.resize(img, (target_width, resized_height), interpolation=cv2.INTER_AREA)
            scale_bg = max(target_width / img.shape[1], target_height / img.shape[0])

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

        elif mode == "crop":
            scale = target_height / img.shape[0]

            resized_img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            frame_width = resized_img.shape[1]
            center_x = int(max_score_face["x"] * scale if max_score_face else frame_width // 2)
            left_x = max(min(center_x - target_width // 2, frame_width - target_width), 0)

            cropped_img = resized_img[0:target_height, left_x:left_x + target_width]

            vout.write(cropped_img)

    if vout:
        vout.release()

    stitch_audio_cmd = (
        f"ffmpeg -y -i {temp_vid_path} -i {audio_path} "
        f"-c:v h264 -preset fast -crf 23 -c:a aac -b:a 128k "
        f"{output_path}"
    )

    subprocess.run(stitch_audio_cmd, shell=True, check=True, text=True)


def create_portrait_vid_top_half(
    tracks, scores, pyframes_path, pyavi_path, audio_path, output_path,
    framerate=25, bottom_video_path: str | None = None,
    clip_duration: float | None = None,
):
    target_width = TARGET_WIDTH
    target_height = TARGET_HEIGHT
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
                "y": track["proc_track"]["y"][fidx],
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

            required_duration = clip_duration or DEFAULT_CLIP_DURATION
            margin_duration = BAIT_MARGIN_SECONDS
            required_frames = int((required_duration + margin_duration) * bait_fps)

            if bait_frame_count > required_frames:
                max_start_frame = bait_frame_count - required_frames
                bait_start_frame = random.randint(0, max_start_frame)
                bait_end_frame = bait_start_frame + required_frames
                print(f"[DEBUG] Randomized bait video segment: frames {bait_start_frame}-{bait_end_frame} (duration: {required_frames / bait_fps:.2f}s)")
            else:
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

        available_frames = bait_end_frame - bait_start_frame
        if available_frames <= 0:
            return None

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
        scale = max(target_width / w, bottom_height / h)
        new_w, new_h = int(w * scale), int(h * scale)
        resized = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)

        # Center-crop to target_width x bottom_height
        x0 = max((new_w - target_width) // 2, 0)
        y0 = max((new_h - bottom_height) // 2, 0)
        cropped = resized[y0:y0 + bottom_height, x0:x0 + target_width]

        if cropped.shape[0] != bottom_height or cropped.shape[1] != target_width:
            canvas = np.zeros((bottom_height, target_width, 3), dtype=np.uint8)
            ch, cw = cropped.shape[:2]
            oy = max((bottom_height - ch) // 2, 0)
            ox = max((target_width - cw) // 2, 0)
            canvas[oy:oy + ch, ox:ox + cw] = cropped
            return canvas

        return cropped

    for fidx, fname in tqdm(enumerate(flist), total=len(flist), desc="Creating top-half portrait vid"):
        img = cv2.imread(fname)
        if img is None:
            continue

        current_faces = faces[fidx]
        max_score_face = max(current_faces, key=lambda face: face['score']) if current_faces else None
        if max_score_face and max_score_face['score'] < 0:
            max_score_face = None

        if vout is None:
            vout = ffmpegcv.VideoWriterNV(
                file=temp_vid_path, codec=None, fps=framerate,
                resize=(target_width, target_height),
            )

        canvas = np.zeros((target_height, target_width, 3), dtype=np.uint8)

        mode = "crop" if max_score_face else "resize"

        if mode == "crop":
            scale = top_height / img.shape[0]
            resized_img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            frame_width = resized_img.shape[1]
            center_x = int(max_score_face["x"] * scale if max_score_face else frame_width // 2)
            left_x = max(min(center_x - target_width // 2, frame_width - target_width), 0)
            cropped_img = resized_img[0:top_height, left_x:left_x + target_width]
            canvas[0:top_height, 0:target_width] = cropped_img
        else:
            scale = target_width / img.shape[1]
            resized_height = int(img.shape[0] * scale)
            resized_img = cv2.resize(img, (target_width, resized_height), interpolation=cv2.INTER_AREA)

            if resized_height >= top_height:
                crop_y = (resized_height - top_height) // 2
                cropped_img = resized_img[crop_y:crop_y + top_height, :]
                canvas[0:top_height, 0:target_width] = cropped_img
            else:
                overlay_y = (top_height - resized_height) // 2
                canvas[overlay_y:overlay_y + resized_height, 0:target_width] = resized_img

        bait_frame = read_bait_frame_resized()
        if bait_frame is not None:
            canvas[top_height:target_height, 0:target_width] = bait_frame
            if fidx == 0:
                print("[DEBUG] Successfully composited bait frame into bottom half")
        elif fidx == 0:
            print("[DEBUG] No bait frame available, keeping bottom half black")

        vout.write(canvas)

    if vout:
        vout.release()

    if bait_cap is not None:
        bait_cap.release()
        print("[DEBUG] Released bait video capture")

    stitch_audio_cmd = (
        f"ffmpeg -y -i {temp_vid_path} -i {audio_path} "
        f"-c:v h264 -preset fast -crf 23 -c:a aac -b:a 128k "
        f"{output_path}"
    )
    subprocess.run(stitch_audio_cmd, shell=True, check=True, text=True)
