import boto3

from config import S3_BUCKET, GAMEPLAY_S3_PREFIX


def get_s3_client():
    return boto3.client("s3")


def upload_to_s3(local_path: str, s3_key: str, bucket: str = S3_BUCKET) -> bool:
    """Upload a file to S3. Returns True on success, False on failure."""
    try:
        client = get_s3_client()
        client.upload_file(str(local_path), bucket, s3_key)
        print(f"Successfully uploaded {local_path} to s3://{bucket}/{s3_key}")
        return True
    except Exception as e:
        print(f"Failed to upload to S3: {str(e)}")
        return False


def download_from_s3(s3_key: str, local_path: str, bucket: str = S3_BUCKET):
    """Download a file from S3."""
    client = get_s3_client()
    client.download_file(bucket, s3_key, str(local_path))


def download_bait_video(bait_video: str, bait_path) -> str | None:
    """Download bait gameplay video from S3. Returns local path string or None."""
    s3_client = get_s3_client()
    try:
        bait_key = f"{GAMEPLAY_S3_PREFIX}/{bait_video}.mp4"
        print(f"Downloading bait gameplay from s3://{S3_BUCKET}/{bait_key} -> {bait_path}")
        s3_client.download_file(S3_BUCKET, bait_key, str(bait_path))
        if bait_path.exists() and bait_path.stat().st_size > 0:
            local_bait_path = str(bait_path)
            print(f"[DEBUG] Bait video downloaded successfully: {local_bait_path} ({bait_path.stat().st_size} bytes)")
            return local_bait_path
        else:
            print("Bait video download resulted in empty file; using blank bottom area")
            return None
    except Exception as e:
        print(f"Failed to download bait gameplay video: {e}")
        try:
            bait_key = f"{GAMEPLAY_S3_PREFIX}/{bait_video}"
            print(f"Retrying download from s3://{S3_BUCKET}/{bait_key} -> {bait_path}")
            s3_client.download_file(S3_BUCKET, bait_key, str(bait_path))
            if bait_path.exists() and bait_path.stat().st_size > 0:
                local_bait_path = str(bait_path)
                print(f"[DEBUG] Bait video downloaded successfully on retry: {local_bait_path} ({bait_path.stat().st_size} bytes)")
                return local_bait_path
        except Exception as e2:
            print(f"Fallback download also failed: {e2}")
    return None
