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
    const { uploadedFileId, userId, youtubeUrl, uuid } = event.data;

    // let clipGenerate = false;

    // Use service role client instead of user session
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

    if (uploadedFile.users.credits > 0) {
      await step.run("update-to-processing", async () => {
        const { error } = await supabase
          .from("uploaded_files")
          .update({ status: "processing" })
          .eq("id", uploadedFileId);
        if (error) {
          throw new Error("Failed to update uploaded file status");
        }
      });

      // Prepare payload based on whether we have YouTube URL or S3 key
      let payload;
      if (youtubeUrl && uuid) {
        // YouTube URL processing
        payload = {
          youtube_url: youtubeUrl,
          uuid: uuid,
        };
      } else {
        // S3 key processing (existing functionality)
        payload = {
          s3_key: uploadedFile.s3_key,
        };
      }
      await step.run("clip-video", async () => {
        await step.fetch(`${process.env.CLIPPER_ENDPOINT}`, {
          method: "POST",
          body: JSON.stringify(payload),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.MODAL_AUTH_TOKEN}`,
          },
        });
      });

      // if (!clipGenerate) {
      //   const clipRes =
      //   if (!clipRes.ok) {
      //     const errorText = await clipRes.text();
      //     clipGenerate = false;
      //   }
      //   console.log("Clip generation completed");
      //   clipGenerate = true;
      // }

      // await step.run("clip-video", async () => {
      //   const response = await fetch(`${process.env.CLIPPER_ENDPOINT}`, {
      //     method: "POST",
      //     body: JSON.stringify(payload),
      //     headers: {
      //       "Content-Type": "application/json",
      //       Authorization: `Bearer ${process.env.MODAL_AUTH_TOKEN}`,
      //     },
      //   });
      // });
    }

    const result = await step.run("send-clip-to-db", async () => {
      // Determine folder prefix based on input type
      let folderPrefix;
      if (youtubeUrl && uuid) {
        // For YouTube processing, use the provided UUID
        folderPrefix = uuid;
      } else {
        // For S3 processing, use the existing logic
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
            credits: Math.max(
              0,
              uploadedFile.users.credits - result.clipsFound
            ),
          })
          .eq("id", userId); // Use the userId from event data
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
  {
    id: "test-step-fetch",
    concurrency: {
      limit: 1,
      key: "event.data.testId",
    },
    retries: 1,
  },
  { event: "test-step-fetch-events" },
  async ({ event, step }) => {
    const { testId } = event.data;

    // Debug the environment variable
    console.log(
      "YouTube downloader endpoint:",
      process.env.NEXT_PUBLIC_YOUTUBE_DOWNLOADER_ENDPOINT
    );

    const healthUrl = `${process.env.NEXT_PUBLIC_YOUTUBE_DOWNLOADER_ENDPOINT}/health`;
    console.log("Full health URL:", healthUrl);

    console.log("About to call step.fetch...");
    const healthResponse = await step.run("health-check-request", async () => {
      return await step.fetch(healthUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
    });

    const delayedResult = await step.run("delayed-processing", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20000));

      return {
        testId,
        processedAt: new Date().toISOString(),
        message: "Test completed after 10 second delay",
      };
    });

    console.log("Test function completed:", delayedResult);
    return delayedResult;
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
