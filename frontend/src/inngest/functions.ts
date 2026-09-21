import { inngest } from "./client";
import { createClient } from "@supabase/supabase-js";
import { ListObjectsV2Command, S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import {
  calculateRequiredCredits,
  validateProcessingRange,
} from "@/lib/credits";
import type { BaitVideoType, LayoutType } from "@/lib/constants";
import { getYouTubeVideoDetails } from "@/lib/youtube";

interface UploadedFileType {
  id: string;
  s3_key: string;
  source_url: string;
  start_time: number;
  end_time: number;
  layout: LayoutType | null;
  bait_video: BaitVideoType | null;
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
    const { uploadedFileId, userId } = event.data;

    const supabase = createServiceClient();

    const uploadedFile = await step.run("get-uploaded-file", async () => {
      const { data, error } = await supabase
        .from("uploaded_files")
        .select(
          `
          id,
          s3_key,
          source_url,
          start_time,
          end_time,
          layout,
          bait_video,
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

    const videoDetails = await step.run("get-youtube-metadata", () =>
      getYouTubeVideoDetails(uploadedFile.source_url),
    );
    const startTime = Number(uploadedFile.start_time);
    const endTime = Number(uploadedFile.end_time);
    const layout = uploadedFile.layout ?? "full";
    const baitVideo = uploadedFile.bait_video ?? "minecraft_night";
    const uuid = uploadedFile.s3_key.split("/")[0]!;

    validateProcessingRange(startTime, endTime, videoDetails.duration);
    const requiredCredits = calculateRequiredCredits(startTime, endTime, layout);
    const isFullVideo =
      startTime === 0 && endTime === videoDetails.duration;

    if (uploadedFile.users.credits >= requiredCredits) {
      await step.run("charge-credits", async () => {
        const { error } = await supabase.rpc("charge_video_processing", {
          p_uploaded_file_id: uploadedFileId,
          p_user_id: userId,
          p_credits: requiredCredits,
        });

        if (error) {
          throw new Error(`Failed to reserve processing credits: ${error.message}`);
        }
      });

      await step.run("update-to-processing", async () => {
        const { error } = await supabase
          .from("uploaded_files")
          .update({ status: "processing" })
          .eq("id", uploadedFileId);
        if (error) {
          throw new Error("Failed to update uploaded file status");
        }
      });

      await step.run("update-video-metadata", async () => {
        const { error } = await supabase
          .from("uploaded_files")
          .update({
            title: videoDetails.title,
            thumbnail: videoDetails.thumbnail,
            source_url: videoDetails.url,
          })
          .eq("id", uploadedFileId);
        if (error) {
          throw new Error(`Failed to update video metadata: ${error.message}`);
        }
      });

      const payload: {
        youtube_url: string;
        uuid: string;
        start_time?: number;
        end_time?: number;
        layout: LayoutType;
        bait_video: BaitVideoType;
      } = {
        youtube_url: videoDetails.url,
        uuid,
        layout,
        bait_video: baitVideo,
      };

      if (!isFullVideo) {
        payload.start_time = startTime;
        payload.end_time = endTime;
      }

      if (!process.env.CLIPPER_ENDPOINT || !process.env.MODAL_AUTH_TOKEN) {
        await refundProcessingCredits(supabase, uploadedFileId, userId);
        throw new Error("CLIPPER_ENDPOINT and MODAL_AUTH_TOKEN are required");
      }

      try {
        const response = await step.fetch(`${process.env.CLIPPER_ENDPOINT}`, {
          method: "POST",
          body: JSON.stringify(payload),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.MODAL_AUTH_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Clipper returned ${response.status}`);
        }
      } catch (error) {
        await refundProcessingCredits(supabase, uploadedFileId, userId);
        throw error;
      }
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
      const folderPrefix = uuid;

      const allKeys = await getClips(folderPrefix);
      const clipKeys = allKeys.filter((key): key is string =>
        Boolean(key && key.includes("clip") && key.endsWith(".mp4"))
      );
      
      if (clipKeys.length > 0) {
        // Insert clips first
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
        }
        
        console.log("Clips inserted:", data);
        
        // Try to read metadata.json and update clips with virality_score and transcript
        try {
          const metadataKey = `${folderPrefix}/metadata.json`;
          console.log("Attempting to read metadata from:", metadataKey);
          
          const metadata = await getMetadataFromS3(metadataKey);
          console.log("Metadata retrieved:", metadata);
          
          if (metadata && metadata.clips && Array.isArray(metadata.clips)) {
            // Update each clip with metadata
            for (const clipMetadata of metadata.clips) {
              const clipS3Key = clipMetadata.s3_key;
              const correspondingClip = data?.find(clip => clip.s3_key === clipS3Key);
              
              if (correspondingClip) {
                                   const { error: updateError } = await supabase
                     .from("clips")
                     .update({
                       virality_score: clipMetadata.virality_score,
                       transcript: clipMetadata.transcript
                     })
                     .eq("id", correspondingClip.id);
                
                if (updateError) {
                  console.error(`Failed to update clip ${correspondingClip.id}:`, updateError);
                } else {
                  console.log(`Successfully updated clip ${correspondingClip.id} with metadata`);
                }
              }
            }
            
            // Delete metadata.json file after successful update
            await deleteFromS3(metadataKey);
            console.log("Metadata file deleted successfully");
          }
        } catch (metadataError) {
          console.error("Failed to process metadata:", metadataError);
          // Don't fail the entire process if metadata reading fails
        }
      }

      return { clipsFound: clipKeys.length };
    });
    
    if (result.clipsFound > 0) {
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
      await step.run("refund-credits", async () => {
        await refundProcessingCredits(supabase, uploadedFileId, userId);
      });
      await step.run("update-to-error", async () => {
        await supabase
          .from("uploaded_files")
          .update({ status: "failed" })
          .eq("id", uploadedFileId);
      });
    }
  }
);

async function refundProcessingCredits(
  supabase: ReturnType<typeof createServiceClient>,
  uploadedFileId: string,
  userId: string,
) {
  const { error } = await supabase.rpc("refund_video_processing", {
    p_uploaded_file_id: uploadedFileId,
    p_user_id: userId,
  });

  if (error) {
    throw new Error(`Failed to refund processing credits: ${error.message}`);
  }
}


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

async function getMetadataFromS3(metadataKey: string) {
  const s3Client = new S3Client({
    region: process.env.AWS_REGION!,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  try {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: metadataKey,
    });

    const response = await s3Client.send(command);
    const metadataString = await response.Body?.transformToString();
    
    if (!metadataString) {
      throw new Error("Empty metadata file");
    }

    return JSON.parse(metadataString);
  } catch (error) {
    console.error("Failed to get metadata from S3:", error);
    throw error;
  }
}

async function deleteFromS3(s3Key: string) {
  const s3Client = new S3Client({
    region: process.env.AWS_REGION!,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  try {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const command = new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: s3Key,
    });

    await s3Client.send(command);
    console.log(`Successfully deleted ${s3Key} from S3`);
  } catch (error) {
    console.error("Failed to delete from S3:", error);
    throw error;
  }
}
