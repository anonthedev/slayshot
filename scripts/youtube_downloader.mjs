import express from "express";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

console.log(process.env.COOKIE_PATH);

app.use(express.json());

// Initialize Gemini client
const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Auth middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const expected = `Bearer ${process.env.YOUTUBE_DOWNLOADER_AUTH}`;
  if (authHeader !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Function to download a video segment with best quality
async function downloadVideoSegment(youtubeUrl, startTime, endTime, outputPath, segmentIndex) {
  console.log(`🎬 Downloading video segment ${segmentIndex} (${startTime}s-${endTime}s) from ${youtubeUrl}`);
  console.log(`📁 Output path: ${outputPath}`);
  
  return new Promise((resolve, reject) => {
    const ytDlpProcess = spawn("yt-dlp", [
      "--cookies", process.env.COOKIE_PATH,
      "--download-sections", `*${startTime}-${endTime}`,
      "-S", "proto:https,vcodec:h264,res,acodec:aac",
      "-f", "bv*[ext=mp4]+ba[ext=m4a]/bv+ba",
      "--merge-output-format", "mp4",
      "-o", outputPath,
      "--ignore-errors",
      "--no-warnings",
      youtubeUrl,
    ]);
    

    // Suppress output to reduce console spam - only log errors
    ytDlpProcess.stdout.on("data", () => {
      // Silently consume stdout
    });

    ytDlpProcess.stderr.on("data", (data) => {
      const errorText = data.toString();
      // Only log actual errors, not progress/info messages
      if (errorText.includes("ERROR") || errorText.includes("CRITICAL")) {
        console.error(`[Segment ${segmentIndex} ERROR] ${errorText}`);
      }
    });

    ytDlpProcess.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp video segment ${segmentIndex} download exited with code ${code}`));
      }
      
      // Verify file was created
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        console.log(`✅ Video segment ${segmentIndex} downloaded successfully: ${stats.size} bytes`);
        resolve();
      } else {
        reject(new Error(`Video segment ${segmentIndex} file not created at: ${outputPath}`));
      }
    });
  });
}

// Function to download audio only in WebM format
async function downloadAudio(youtubeUrl, outputPath) {
  console.log(`🎵 Downloading best quality audio (WebM) from ${youtubeUrl}`);
  console.log(`📁 Output path: ${outputPath}`);
  
  return new Promise((resolve, reject) => {
    const ytDlpProcess = spawn("yt-dlp", [
      "--cookies", process.env.COOKIE_PATH,
      "-f", "bestaudio[ext=webm]/bestaudio",
      "-o", outputPath,
      "--ignore-errors",
      "--no-warnings",
      youtubeUrl,
    ]);

    // Suppress output to reduce console spam
    ytDlpProcess.stdout.on("data", () => {
      // Silently consume stdout
    });

    ytDlpProcess.stderr.on("data", (data) => {
      const errorText = data.toString();
      // Only log actual errors
      if (errorText.includes("ERROR") || errorText.includes("CRITICAL")) {
        console.error(`[Audio Download ERROR] ${errorText}`);
      }
    });

    ytDlpProcess.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp audio download exited with code ${code}`));
      }
      
      // Verify file was created
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        console.log(`✅ Audio downloaded successfully: ${stats.size} bytes`);
        resolve();
      } else {
        reject(new Error(`Audio file not created at: ${outputPath}`));
      }
    });
  });
}

// Function to upload file to S3
async function uploadToS3(filePath, s3Key, contentType = "audio/webm") {
  console.log(`⬆️  Uploading to S3 as ${s3Key}`);
  
  const fileSize = fs.statSync(filePath).size;
  const fileStream = fs.createReadStream(filePath);

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: s3Key,
      Body: fileStream,
      ContentType: contentType,
      ContentLength: fileSize,
    })
  );

  console.log(`✅ Uploaded ${fileSize} bytes to S3`);
}

// Function to upload JSON data to S3
async function uploadJSONToS3(data, s3Key) {
  console.log(`⬆️  Uploading JSON to S3 as ${s3Key}`);
  
  const jsonString = JSON.stringify(data, null, 2);
  const buffer = Buffer.from(jsonString, 'utf-8');

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: s3Key,
      Body: buffer,
      ContentType: "application/json",
      ContentLength: buffer.length,
    })
  );

  console.log(`✅ Uploaded JSON (${buffer.length} bytes) to S3`);
}

// Function to download JSON from S3
async function downloadJSONFromS3(s3Key) {
  console.log(`⬇️  Downloading JSON from S3: ${s3Key}`);
  
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: s3Key,
    })
  );

  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  
  const jsonString = Buffer.concat(chunks).toString('utf-8');
  const data = JSON.parse(jsonString);
  
  console.log(`✅ Downloaded JSON from S3`);
  return data;
}

// Function to delete file from S3
async function deleteFromS3(s3Key) {
  console.log(`🗑️  Deleting from S3: ${s3Key}`);
  
  await s3.send(
    new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: s3Key,
    })
  );

  console.log(`✅ Deleted ${s3Key} from S3`);
}

// Function to call Modal transcribe_audio endpoint
async function transcribeAudio(s3Key) {
  console.log(`🎤 Calling Modal transcribe_audio for ${s3Key}`);
  
  const modalEndpoint = `${process.env.MODAL_TRANSCRIPTION_ENDPOINT}`;
  const authToken = process.env.MODAL_ENDPOINT_AUTH;
  
  if (!modalEndpoint || !authToken) {
    throw new Error("Modal endpoint or auth token not configured");
  }

  const response = await fetch(modalEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      s3_key: s3Key
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Modal transcription failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  console.log(`✅ Transcription complete: ${result.word_count || 0} words`);
  
  return result;
}

// Function to identify viral moments using Gemini (copied from main.py)
async function identifyViralMoments(transcript) {
  console.log(`🧠 Analyzing transcript for viral moments using Gemini...`);
  
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured");
  }

  const model = genai.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17" });
  
  const prompt = `You are given a transcript of a podcast video, where each word includes its start and end time in seconds. Your goal is to extract question-answer clips from this transcript.

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

[{"start": seconds, "end": seconds, "virality_score": score}, ...clip2, clip3]

- "start" and "end" must use only the timestamps from the transcript.
- "virality_score" must be an integer from 1-10, where 10 is most viral-worthy (extremely engaging, shareable, quotable) and 1 is least viral-worthy (still good but less compelling).
- Aim to extract 40–60s clips where possible.
- Do not include any extra metadata or output — only the JSON list.

Virality Score Guidelines:
- 9-10: Explosive moments, shocking revelations, extremely funny, deeply emotional, or highly quotable
- 7-8: Very engaging content, strong opinions, memorable insights, good humor
- 5-6: Solid content, interesting discussions, moderate engagement potential
- 3-4: Decent content but less compelling, standard conversations
- 1-2: Lowest priority clips, filler content

If no valid clips are found:

Return exactly:
[]

The transcript is as follows:

${JSON.stringify(transcript)}`;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    console.log(`🧠 Gemini response: ${responseText}`);
    
    // Clean up the response to extract JSON
    let cleanJsonString = responseText.trim();
    if (cleanJsonString.startsWith("```json")) {
      cleanJsonString = cleanJsonString.substring("```json".length).trim();
    }
    if (cleanJsonString.endsWith("```")) {
      cleanJsonString = cleanJsonString.substring(0, cleanJsonString.length - "```".length).trim();
    }
    
    const clipMoments = JSON.parse(cleanJsonString);
    
    if (!Array.isArray(clipMoments)) {
      console.log("❌ Gemini returned non-array response, using empty array");
      return [];
    }
    
    console.log(`✅ Found ${clipMoments.length} viral moments`);
    return clipMoments;
    
  } catch (error) {
    console.error("❌ Error identifying viral moments:", error);
    return [];
  }
}

// Diarization endpoint (transcription only)
app.post("/diarize", authMiddleware, async (req, res) => {
  const { youtubeUrl, uuid } = req.body;
  
  if (!youtubeUrl || typeof youtubeUrl !== "string") {
    return res.status(400).json({ error: "Missing or invalid YouTube URL" });
  }
  
  if (!uuid || typeof uuid !== "string") {
    return res.status(400).json({ error: "Missing or invalid UUID" });
  }

  const tempDir = tmpdir();
  const audioPath = path.join(tempDir, `${uuid}_speech.webm`);
  const audioS3Key = `${uuid}/speech.webm`;
  const transcriptS3Key = `${uuid}/transcript.json`;
  
  try {
    console.log(`🚀 Starting diarization for session: ${uuid}`);
    
    await downloadAudio(youtubeUrl, audioPath);
    await uploadToS3(audioPath, audioS3Key, "audio/webm");
    
    fs.unlinkSync(audioPath);
    console.log("🗑️  Local audio file cleaned up");
    
    const transcriptionResult = await transcribeAudio(audioS3Key);
    
    // Save transcript to S3
    await uploadJSONToS3(transcriptionResult.transcript || [], transcriptS3Key);
    
    console.log(`✅ Diarization complete for session: ${uuid}`);
    
    return res.status(200).json({
      success: true,
      session_id: uuid,
      audio_s3_key: audioS3Key,
      transcript_s3_key: transcriptS3Key,
      word_count: transcriptionResult.word_count || 0,
      message: "Audio diarization completed successfully"
    });
    
  } catch (error) {
    console.error(`❌ Diarization failed for session ${uuid}:`, error);
    
    // Clean up any remaining files
    try {
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
        console.log("🗑️  Cleaned up local file after error");
      }
    } catch (cleanupError) {
      console.error("Cleanup error:", cleanupError);
    }
    
    return res.status(500).json({ 
      success: false, 
      session_id: uuid,
      error: "Diarization failed",
      details: error.message 
    });
  }
});

// Viral moments detection endpoint (takes S3 transcript key)
app.post("/viral-moments", authMiddleware, async (req, res) => {
  const { transcript_s3_key, uuid } = req.body;
  
  if (!transcript_s3_key || typeof transcript_s3_key !== "string") {
    return res.status(400).json({ error: "Missing or invalid transcript_s3_key" });
  }
  
  if (!uuid || typeof uuid !== "string") {
    return res.status(400).json({ error: "Missing or invalid UUID" });
  }
  
  try {
    console.log(`🧠 Starting viral moments analysis for session: ${uuid}`);
    
    // Download transcript from S3
    const transcript = await downloadJSONFromS3(transcript_s3_key);
    
    // Analyze for viral moments
    const allViralMoments = await identifyViralMoments(transcript);
    
    // Limit to first clip only (similar to main.py clip_moments[:1])
    const viralMoments = allViralMoments.slice(0, 1);
    
    // Delete transcript file from S3
    // await deleteFromS3(transcript_s3_key);
    
    console.log(`✅ Viral moments analysis complete for session: ${uuid}`);
    console.log(`📊 Found ${allViralMoments.length} total moments, returning ${viralMoments.length} clips`);
    
    return res.status(200).json({
      success: true,
      session_id: uuid,
      viral_moments: viralMoments,
      clip_count: viralMoments.length,
      total_moments_found: allViralMoments.length,
      message: "Viral moments analysis completed successfully"
    });
    
  } catch (error) {
    console.error(`❌ Viral moments analysis failed for session ${uuid}:`, error);
    
    return res.status(500).json({ 
      success: false, 
      session_id: uuid,
      error: "Viral moments analysis failed",
      details: error.message 
    });
  }
});

// Video segments download endpoint
app.post("/download-segments", authMiddleware, async (req, res) => {
  const { youtubeUrl, segments, uuid } = req.body;
  
  if (!youtubeUrl || typeof youtubeUrl !== "string") {
    return res.status(400).json({ error: "Missing or invalid YouTube URL" });
  }
  
  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    return res.status(400).json({ error: "Missing or invalid segments array" });
  }
  
  if (!uuid || typeof uuid !== "string") {
    return res.status(400).json({ error: "Missing or invalid UUID" });
  }

  // Validate segments format
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment.start || !segment.end || typeof segment.start !== "number" || typeof segment.end !== "number") {
      return res.status(400).json({ error: `Invalid segment at index ${i}: must have numeric start and end times` });
    }
    if (segment.start >= segment.end) {
      return res.status(400).json({ error: `Invalid segment at index ${i}: start time must be less than end time` });
    }
  }

  const tempDir = tmpdir();
  const downloadedFiles = [];
  const uploadedSegments = [];
  
  try {
    console.log(`🚀 Starting parallel video segments download for session: ${uuid}`);
    console.log(`📊 Processing ${segments.length} segments`);
    
    // Download all segments in parallel
    const downloadPromises = segments.map(async (segment, index) => {
      const segmentPath = path.join(tempDir, `${uuid}_segment_${index}.mp4`);
      const s3Key = `${uuid}/segment_${index}.mp4`;
      
      try {
        // Download video segment
        await downloadVideoSegment(youtubeUrl, segment.start, segment.end, segmentPath, index);
        downloadedFiles.push(segmentPath);
        
        // Upload to S3
        await uploadToS3(segmentPath, s3Key, "video/mp4");
        
        return {
          index,
          start_time: segment.start,
          end_time: segment.end,
          s3_key: s3Key,
          local_path: segmentPath
        };
        
      } catch (error) {
        console.error(`❌ Failed to process segment ${index}:`, error);
        throw error;
      }
    });
    
    // Wait for all downloads and uploads to complete
    const results = await Promise.all(downloadPromises);
    uploadedSegments.push(...results);
    
    // Clean up local files
    for (const filePath of downloadedFiles) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`🗑️  Cleaned up local file: ${path.basename(filePath)}`);
        }
      } catch (cleanupError) {
        console.error(`Warning: Failed to cleanup ${filePath}:`, cleanupError);
      }
    }
    
    console.log(`✅ Video segments download complete for session: ${uuid}`);
    
    return res.status(200).json({
      success: true,
      session_id: uuid,
      segments_processed: uploadedSegments.length,
      segments: uploadedSegments.map(seg => ({
        index: seg.index,
        start_time: seg.start_time,
        end_time: seg.end_time,
        s3_key: seg.s3_key
      })),
      message: "Video segments download completed successfully"
    });
    
  } catch (error) {
    console.error(`❌ Video segments download failed for session ${uuid}:`, error);
    
    // Clean up any remaining files
    for (const filePath of downloadedFiles) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`🗑️  Cleaned up local file after error: ${path.basename(filePath)}`);
        }
      } catch (cleanupError) {
        console.error(`Cleanup error for ${filePath}:`, cleanupError);
      }
    }
    
    return res.status(500).json({ 
      success: false, 
      session_id: uuid,
      segments_processed: uploadedSegments.length,
      error: "Video segments download failed",
      details: error.message 
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  console.log("Health check endpoint hit");
  res.json({ 
    status: "healthy", 
    service: "YouTube Audio Processing",
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`🚀 YouTube Audio Processing Service running at http://localhost:${PORT}`);
  console.log(`📍 Endpoints:`);
  console.log(`   POST /diarize         - {youtubeUrl, uuid} → Audio diarization + transcript to S3`);
  console.log(`   POST /viral-moments   - {transcript_s3_key, uuid} → Viral moments detection`);
  console.log(`   POST /download-segments - {youtubeUrl, segments, uuid} → Download video segments in parallel`);
  console.log(`   GET  /health          - Health check`);
});