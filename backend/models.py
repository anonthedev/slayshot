from pydantic import BaseModel


class ProcessVideoRequest(BaseModel):
    s3_key: str | None = None
    youtube_url: str | None = None
    uuid: str | None = None
    start_time: float | None = None
    end_time: float | None = None
    layout: str | None = "full"
    bait_video: str | None = "minecraft_night"


class TranscribeAudioRequest(BaseModel):
    s3_key: str


class SegmentInfo(BaseModel):
    s3_key: str
    start_time: float
    end_time: float
    virality_score: int | None = None


class ProcessSegmentsRequest(BaseModel):
    segments: list[SegmentInfo]
    uuid: str
    transcript_s3_key: str
    layout: str | None = "full"
    bait_video: str | None = "minecraft_night"
