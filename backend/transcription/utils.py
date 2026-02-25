def transcript_to_string(transcript: list) -> str:
    """Convert diarized transcript (list of word objects) to a simple string."""
    if not transcript:
        return ""

    words = []
    for word_segment in transcript:
        word = word_segment.get("word", "").strip()
        if word:
            words.append(word)

    return " ".join(words)


def filter_transcript_by_time(
    transcript: list, start_time: float, end_time: float
) -> list:
    """Filter transcript to only include words within the specified time range.

    Timestamps are adjusted to be relative to start_time.
    """
    filtered = []
    for word_segment in transcript:
        if (
            word_segment.get("start") is not None
            and word_segment.get("end") is not None
            and word_segment.get("start") < end_time
            and word_segment.get("end") > start_time
        ):
            adjusted_segment = word_segment.copy()
            adjusted_segment["start"] = max(0, word_segment["start"] - start_time)
            adjusted_segment["end"] = max(0, word_segment["end"] - start_time)
            filtered.append(adjusted_segment)
    return filtered
