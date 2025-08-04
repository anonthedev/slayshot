import { inngest } from "./client";
import { createClient } from "@supabase/supabase-js";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

interface UploadedFileType {
  id: string;
  s3_key: string;
  users: {
    id: string;
    credits: number;
  };
}

// Create a Supabase client with service role for server-side operations
const createServiceClient = () => {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );
};

export const clipVideo = inngest.createFunction(
  {
    id: "clip-video",
    concurrency: {
      limit: 1,
      key: "event.data.userId",
    },
    retries: 1,
  },
  { event: "clip-video-events" },
  async ({ event, step }) => {
    const { uploadedFileId, userId, youtubeUrl, uuid, startTime, endTime } = event.data;

    // Get video duration and metadata to determine if user is selecting full video
    let videoDuration = 0;
    let videoTitle = null;
    let videoThumbnail = null;
    
    if (youtubeUrl) {
      try {
        const videoDetailsResponse = await step.fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/youtube/details`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: youtubeUrl }),
        });
        
        if (videoDetailsResponse.ok) {
          const videoDetails = await videoDetailsResponse.json();
          videoDuration = videoDetails.duration;
          videoTitle = videoDetails.title;
          videoThumbnail = videoDetails.thumbnail;
        }
      } catch (error) {
        console.error("Failed to get video duration:", error);
      }
    }

    // Determine if user is selecting the full video length
    const isFullVideo = startTime === 0 && endTime === videoDuration;
    
    console.log(`Processing video: startTime=${startTime}, endTime=${endTime}, videoDuration=${videoDuration}, isFullVideo=${isFullVideo}`);

    const supabase = createServiceClient();

    const uploadedFile = await step.run("get-uploaded-file", async () => {
      const { data, error } = await supabase
        .from("uploaded_files")
        .select(
          `
          id,
          s3_key,
          users(
              id,
              credits
          )
          `
        )
        .eq("id", uploadedFileId)
        .single();
      if (!data) {
        throw new Error(
          `Uploaded file not found: ${uploadedFileId} \n error: ${error?.message}`
        );
      }
      return data as unknown as UploadedFileType;
    });

    if (uploadedFile.users.credits >= Math.ceil((endTime - startTime) / 60)) {
      await step.run("update-to-processing", async () => {
        const { error } = await supabase
          .from("uploaded_files")
          .update({ status: "processing" })
          .eq("id", uploadedFileId);
        if (error) {
          throw new Error("Failed to update uploaded file status");
        }
      });

      // Update video metadata if available (for YouTube videos)
      if (youtubeUrl && (videoTitle || videoThumbnail)) {
        await step.run("update-video-metadata", async () => {
          const updateData: { title?: string; thumbnail?: string } = {};
          if (videoTitle) updateData.title = videoTitle;
          if (videoThumbnail) updateData.thumbnail = videoThumbnail;
          
          const { error } = await supabase
            .from("uploaded_files")
            .update(updateData)
            .eq("id", uploadedFileId);
          if (error) {
            console.error("Failed to update video metadata:", error);
          }
        });
      }

      let payload: {
        youtube_url?: string;
        uuid?: string;
        start_time?: number;
        end_time?: number;
        s3_key?: string;
      }
      
      if (youtubeUrl && uuid) {
        // YouTube URL processing
        payload = {
          youtube_url: youtubeUrl,
          uuid: uuid,
        };
        
        // Only include time parameters if not selecting full video
        if (!isFullVideo) {
          payload.start_time = startTime;
          payload.end_time = endTime;
        } else {
          console.log("Full video selected - not passing time parameters to modal backend");
        }
        
        console.log("Payload:", payload);
      } else {
        // S3 key processing (existing functionality)
        payload = {
          s3_key: uploadedFile.s3_key,
        };
      }
      await step.fetch(`${process.env.CLIPPER_ENDPOINT}`, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.MODAL_AUTH_TOKEN}`,
        },
      });
    } else {
      // User doesn't have enough credits
      await step.run("update-to-no-credits", async () => {
        const { error } = await supabase
          .from("uploaded_files")
          .update({ status: "no credits" })
          .eq("id", uploadedFileId);
        if (error) {
          throw new Error("Failed to update uploaded file status");
        }
      });
      return { success: false, reason: "insufficient credits" };
    }

    // Only proceed with clip processing if we have enough credits
    const result = await step.run("send-clip-to-db", async () => {
      let folderPrefix;
      if (youtubeUrl && uuid) {
        folderPrefix = uuid;
      } else {
        folderPrefix = uploadedFile.s3_key.split("/")[0]!;
      }

      const allKeys = await getClips(folderPrefix);
      const clipKeys = allKeys.filter((key): key is string =>
        key!.includes("clip")
      );
      if (clipKeys.length > 0) {
        const { data, error } = await supabase
          .from("clips")
          .insert(
            clipKeys.map((key) => ({
              s3_key: key,
              uploaded_file_id: uploadedFileId,
              user_id: userId,
            }))
          )
          .select();
        if (error) {
          throw new Error(`Failed to insert clips: ${error.message}`);
        } else {
          console.log(data);
        }
      }

      return { clipsFound: clipKeys.length };
    });
    
    if (result.clipsFound > 0) {
      await step.run("update-credits", async () => {
        await supabase
          .from("users")
          .update({
            credits: uploadedFile.users.credits - Math.ceil((endTime - startTime) / 60)
          })
          .eq("id", userId);
      });
      await step.run("update-to-processed", async () => {
        const { error } = await supabase
          .from("uploaded_files")
          .update({ status: "processed" })
          .eq("id", uploadedFileId);
        if (error) {
          throw new Error("Failed to update uploaded file status");
        }
      });
    } else {
      await step.run("update-to-error", async () => {
        await supabase
          .from("uploaded_files")
          .update({ status: "failed" })
          .eq("id", uploadedFileId);
      });
    }
  }
);

export const clipYouTubeVideoWorkflow = inngest.createFunction(
  {
    id: "clip-youtube-video-workflow",
    concurrency: {
      limit: 1,
      key: "event.data.uploadedFileId",
    },
    retries: 0,
  },
  { event: "clip-youtube-video-workflow" },
  async ({ event, step }) => {
    const { uploadedFileId, userId, youtubeUrl, uuid } = event.data;

    const supabase = createServiceClient();

    const userCredits = await step.run("check-user-credits", async () => {
      const { data, error } = await supabase
        .from("users")
        .select("credits")
        .eq("id", userId)
        .single();

      if (error || !data) {
        throw new Error(`Failed to get user credits: ${error?.message}`);
      }

      return data.credits;
    });

    if (userCredits <= 0) {
      await step.run("update-to-no-credits", async () => {
        const { error } = await supabase
          .from("uploaded_files")
          .update({ status: "no credits" })
          .eq("id", uploadedFileId);

        if (error) {
          throw new Error("Failed to update uploaded file status");
        }
      });

      return { success: false, reason: "no credits" };
    }

    try {
      const transcriptResult = await step.fetch(
        `${process.env.NEXT_PUBLIC_YOUTUBE_DOWNLOADER_ENDPOINT}/diarize`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.YOUTUBE_DOWNLOADER_AUTH}`,
          },
          body: JSON.stringify({
            youtubeUrl,
            uuid,
          }),
        }
      );

      if (!transcriptResult.ok) {
        const errorText = await transcriptResult.text();
        throw new Error(
          `Diarization failed: ${transcriptResult.status} - ${errorText}`
        );
      }

      const transcriptData = await transcriptResult.json();
      const transcriptS3Key = transcriptData.transcript_s3_key;

      console.log("Transcription completed:", transcriptData);

      const viralMomentsResult = await step.fetch(
        `${process.env.NEXT_PUBLIC_YOUTUBE_DOWNLOADER_ENDPOINT}/viral-moments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.YOUTUBE_DOWNLOADER_AUTH}`,
          },
          body: JSON.stringify({
            transcript_s3_key: transcriptS3Key,
            uuid,
          }),
        }
      );

      if (!viralMomentsResult.ok) {
        const errorText = await viralMomentsResult.text();
        throw new Error(
          `Viral moments generation failed: ${viralMomentsResult.status} - ${errorText}`
        );
      }

      const viralMomentsData = await viralMomentsResult.json();
      const viralMoments = viralMomentsData.viral_moments;

      console.log("Viral moments generated:", viralMomentsData);

      if (!viralMoments || viralMoments.length === 0) {
        await step.run("update-to-no-clips", async () => {
          await supabase
            .from("uploaded_files")
            .update({ status: "failed" })
            .eq("id", uploadedFileId);
        });
        return { success: false, reason: "no viral moments found" };
      }

      const segmentsResult = await step.fetch(
        `${process.env.NEXT_PUBLIC_YOUTUBE_DOWNLOADER_ENDPOINT}/download-segments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.YOUTUBE_DOWNLOADER_AUTH}`,
          },
          body: JSON.stringify({
            youtubeUrl,
            segments: viralMoments,
            uuid,
          }),
        }
      );

      if (!segmentsResult.ok) {
        const errorText = await segmentsResult.text();
        throw new Error(
          `Segment download failed: ${segmentsResult.status} - ${errorText}`
        );
      }

      const segmentsData = await segmentsResult.json();
      // const segments = segmentsData.segments;

      console.log("Video segments downloaded:", segmentsData);

      // Comment out Modal backend call for testing
      // const processResult = await step.fetch(`${process.env.MODAL_PROCESS_SEGMENTS_ENDPOINT}`, {
      //   method: "POST",
      //   headers: {
      //     "Content-Type": "application/json",
      //     Authorization: `Bearer ${process.env.MODAL_AUTH_TOKEN}`,
      //   },
      //   body: JSON.stringify({
      //     segments: segments.map((seg: any) => ({
      //       s3_key: seg.s3_key,
      //       start_time: seg.start_time,
      //       end_time: seg.end_time,
      //     })),
      //     uuid,
      //     transcript_s3_key: transcriptS3Key,
      //   }),
      // });

      // if (!processResult.ok) {
      //   const errorText = await processResult.text();
      //   throw new Error(`Segment processing failed: ${processResult.status} - ${errorText}`);
      // }

      // const processData = await processResult.json();

      // console.log("Segments processed successfully:", processData);

      const result = await step.run("save-clips-to-db", async () => {
        // Instead of getting clips from S3, create an arbitrary clip for testing
        const arbitraryClip = {
          s3_key: `${uuid}/clip_test_${Date.now()}.mp4`,
          uploaded_file_id: uploadedFileId,
          user_id: userId,
        };

        const { data, error } = await supabase
          .from("clips")
          .insert([arbitraryClip])
          .select();

        if (error) {
          throw new Error(`Failed to insert clips: ${error.message}`);
        } else {
          console.log("Clips saved to database:", data);
        }

        console.log("Arbitrary clip added:", arbitraryClip);
        console.log("Clips found:", 1);

        return { clipsFound: 1, alreadyExisted: false };
      });

      if (result.clipsFound > 0) {
        await step.run("update-credits", async () => {
          await supabase
            .from("users")
            .update({
              credits: Math.max(0, userCredits - result.clipsFound),
            })
            .eq("id", userId);
        });

        await step.run("update-to-processed", async () => {
          const { error } = await supabase
            .from("uploaded_files")
            .update({ status: "processed" })
            .eq("id", uploadedFileId);
          if (error) {
            throw new Error("Failed to update uploaded file status");
          }
        });
      } else {
        await step.run("update-to-error", async () => {
          await supabase
            .from("uploaded_files")
            .update({ status: "failed" })
            .eq("id", uploadedFileId);
        });
      }

      return {
        success: true,
        message: "YouTube video workflow completed successfully",
        clips_processed: result.clipsFound,
        uuid,
      };
    } catch (error) {
      console.error("YouTube workflow error:", error);

      await step.run("update-to-failed", async () => {
        await supabase
          .from("uploaded_files")
          .update({ status: "failed" })
          .eq("id", uploadedFileId);
      });

      throw error;
    }
  }
);

export const testStepFetch = inngest.createFunction(
  { id: "test-step-fetch" },
  { event: "test-step-fetch-events" },
  async ({ step }) => {
    const healthUrl = `http://localhost:3000/api/health`;

    const healthCheckResult = await step.fetch(healthUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const loggingHealth = await step.run("logging-health", async () => {
      const healthCheckResultJson = await healthCheckResult.json();
      console.log("Health check result:", healthCheckResultJson.message);
      return healthCheckResultJson;
    });

    return loggingHealth;
  }
);

export const calculateClipVirality = inngest.createFunction(
  {
    id: "calculate-clip-virality",
    concurrency: {
      limit: 5,
      key: "event.data.clipId",
    },
    retries: 1,
  },
  { event: "calculate-clip-virality" },
  async ({ event, step }) => {
    const { clipId, s3Key } = event.data;

    const supabase = createServiceClient();

    try {
      // Step 1: Get the clip from the database
      const clipResult = await step.run("get-clip", async () => {
        const { data, error } = await supabase
          .from("clips")
          .select("*")
          .eq("id", clipId)
          .single();

        if (error || !data) {
          throw new Error(`Clip not found: ${clipId}`);
        }

        return data;
      });

      // Step 2: Get or create transcript
      const transcriptResult = await step.run("get-or-create-transcript", async () => {
        // Check if clip already has a transcript
        if (clipResult.transcript) {
          console.log("Using existing transcript from database");
          return JSON.parse(clipResult.transcript);
        }

        console.log("Transcript not found, calling transcription endpoint");
        const transcriptionEndpoint = process.env.MODAL_TRANSCRIPTION_ENDPOINT;
        if (!transcriptionEndpoint) {
          throw new Error("MODAL_TRANSCRIPTION_ENDPOINT environment variable not set");
        }

        const response = await fetch(`${process.env.MODAL_TRANSCRIPTION_ENDPOINT}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.MODAL_AUTH_TOKEN}`,
          },
          body: JSON.stringify({
            s3_key: s3Key,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Transcription failed: ${response.status} - ${errorText}`);
        }

        const transcriptData = await response.json();
        
        if (!transcriptData.success) {
          throw new Error(`Transcription failed: ${transcriptData.error || 'Unknown error'}`);
        }

        // Store the transcript in the database for future use
        const { error: updateError } = await supabase
          .from("clips")
          .update({ transcript: JSON.stringify(transcriptData.transcript) })
          .eq("id", clipId);

        if (updateError) {
          console.error("Failed to store transcript:", updateError);
        }

        return transcriptData.transcript;
      });

      // Step 3: Analyze virality using OpenAI
      const viralityScore = await step.run("analyze-virality", async () => {
        // Prepare transcript text for analysis
        const transcriptText = transcriptResult
          .map((segment: any) => segment.word)
          .join(' ');

        if (!transcriptText.trim()) {
          throw new Error("Empty transcript received");
        }

        const prompt = `
You are an expert social media analyst specializing in viral content prediction. 

Analyze the following video transcript and rate its viral potential on a scale of 1-10, where:
- 1-2: Low virality (boring, generic content)
- 3-4: Below average (somewhat interesting but unlikely to go viral)
- 5-6: Average (decent content with moderate shareability)
- 7-8: High potential (engaging, shareable, likely to perform well)
- 9-10: Viral gold (extremely engaging, highly shareable, strong emotional impact)

Consider these factors:
1. Emotional impact (humor, surprise, inspiration, controversy)
2. Shareability and relatability
3. Uniqueness and memorability
4. Entertainment value
5. Quotability and clip-worthiness
6. Audience engagement potential

Transcript:
"${transcriptText}"

Please respond with ONLY a single number between 1 and 10 (you can use decimals like 7.5).
`;

        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "gpt-4o",
            input: prompt,
            max_tokens: 10,
            temperature: 0.3,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(`OpenAI API failed: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
        }

        const data = await response.json();
        const scoreText = data.output_text?.trim();
        
        if (!scoreText) {
          throw new Error("No response from OpenAI");
        }

        const score = parseFloat(scoreText);
        
        if (isNaN(score) || score < 1 || score > 10) {
          throw new Error(`Invalid virality score: ${scoreText}`);
        }

        return Math.round(score * 10) / 10; // Round to 1 decimal place
      });

      // Step 4: Store the virality score in the database
      await step.run("store-virality-score", async () => {
        const { error } = await supabase
          .from("clips")
          .update({ 
            virality_score: viralityScore
          })
          .eq("id", clipId);

        if (error) {
          throw new Error(`Failed to store virality score: ${error.message}`);
        }
      });

      return {
        success: true,
        clipId,
        viralityScore,
        message: "Virality analysis completed successfully",
      };

    } catch (error) {
      console.error("Virality calculation error:", error);

      // Store error in database  
      await step.run("store-virality-error", async () => {
        await supabase
          .from("clips")
          .update({ 
            virality_score: null
          })
          .eq("id", clipId);
      });

      throw error;
    }
  }
);

async function getClips(prefix: string) {
  const s3Client = new S3Client({
    region: process.env.AWS_REGION!,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  const command = new ListObjectsV2Command({
    Bucket: process.env.S3_BUCKET_NAME!,
    Prefix: prefix,
  });

  const response = await s3Client.send(command);
  return response.Contents?.map((item) => item.Key).filter(Boolean) || [];
}
