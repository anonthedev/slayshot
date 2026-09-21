import os
import subprocess
import uuid
from datetime import timedelta

from config import COOKIE_PATH


def download_youtube_video(
    youtube_url: str,
    output_path: str,
    start_time: float = None,
    end_time: float = None,
) -> bool:
    """Download a YouTube video using yt-dlp, optionally specifying a time range."""
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
            "-o", temp_file,
        ]

        if os.path.exists(COOKIE_PATH):
            command += ["--cookies", COOKIE_PATH]

        if start_time is not None or end_time is not None:
            start_str = seconds_to_hhmmss(start_time or 0)
            end_str = seconds_to_hhmmss(end_time) if end_time else ''
            section = f"*{start_str}-{end_str}"
            command += ["--download-sections", section]

        command.append(youtube_url)

        print(f"[INFO] Running command: {' '.join(command)}")
        subprocess.run(command, check=True, capture_output=True, text=True)

        if start_time or end_time:
            if os.path.exists(temp_file):
                os.rename(temp_file, output_path)
        else:
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
