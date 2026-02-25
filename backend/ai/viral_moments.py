GEMINI_MODEL = "gemini-2.5-flash"

VIRAL_MOMENTS_PROMPT = """You are given a transcript of a video where each word includes its start and end time in seconds. The video may be a podcast (e.g., Lex Fridman style), an interview, a vlog, a monologue, or any content with a speaking person visible on screen. Your task is to extract short, viral-worthy clips from the transcript.

Extraction Criteria:

Each clip must:
- Be 30 to 60 seconds long. Prefer 40\u201360s, but allow 30\u201339s if the segment is powerful and self-contained.
- Start and end cleanly at sentence boundaries, using only the provided word-level timestamps \u2014 do not invent or adjust timestamps.
- Include complete thoughts \u2014 thoughtful answers, memorable questions, emotional insights, rants, jokes, monologues, hot takes, or impactful quotes \u2014 even if it's only one speaker.
- Optionally include a few extra sentences before the main moment to provide helpful setup or context.
- Be non-overlapping with other clips \u2014 each clip must cover a unique part of the video.
- Use only the exact start and end timestamps from the transcript.

What to Focus On:
- Deep or thought-provoking exchanges (like in Lex Fridman or other podcasts).
- Emotionally powerful moments \u2014 vulnerability, intensity, or personal reflection.
- Funny, surprising, or viral-worthy lines.
- Strong opinions, motivational moments, or mic-drop takes.
- Clear and complete Q&A exchanges, especially when the answer is engaging or moving.

Output Format (Must be valid for json.loads in Python):

Return a list of JSON objects, each representing a clip:

[{"start": seconds, "end": seconds, "virality_score": score}, ...clip2, clip3]

- "start" and "end" must use only the timestamps from the transcript.
- "virality_score" must be an integer from 1-10, where 10 is most viral-worthy (extremely engaging, shareable, quotable) and 1 is least viral-worthy (still good but less compelling).
- Aim to extract 40\u201360s clips where possible.
- Do not include any extra metadata or output \u2014 only the JSON list.
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

The transcript is as follows:\n\n"""


def identify_viral_moments(gemini_client, transcript: dict) -> str:
    """Use Gemini to identify viral-worthy moments from a transcript."""
    prompt = VIRAL_MOMENTS_PROMPT + str(transcript)
    response = gemini_client.models.generate_content(
        model=GEMINI_MODEL, contents=prompt
    )
    return response.text
