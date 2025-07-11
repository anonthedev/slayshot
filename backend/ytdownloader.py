import yt_dlp

url = "https://www.youtube.com/watch?v=cp1lprZUQcE"

ydl_opts = {
    'format': 'bv*+ba/best',  # best video + best audio, fallback to best available
    'outtmpl': 'input3full.%(ext)s',  # filename template
    'merge_output_format': 'mp4',  # force merged file to be .mp4
}

with yt_dlp.YoutubeDL(ydl_opts) as ydl:
    ydl.download([url])
