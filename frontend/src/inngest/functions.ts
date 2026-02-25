import { inngest } from "./client";
import { createClient } from "@supabase/supabase-js";
import { ListObjectsV2Command, S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

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
    const { uploadedFileId, userId, youtubeUrl, uuid, startTime, endTime, layout, baitVideo } = event.data;

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
        layout?: string;
        bait_video?: string;
      }
      
      if (youtubeUrl && uuid) {
        // YouTube URL processing
        payload = {
          youtube_url: youtubeUrl,
          uuid: uuid,
        };
        
        // Only include layout if provided
        if (layout) {
          payload.layout = layout;
        }
        
        // Only include bait_video if provided
        if (baitVideo) {
          payload.bait_video = baitVideo;
        }
        
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
        
        // Only include layout if provided
        if (layout) {
          payload.layout = layout;
        }
        
        // Only include bait_video if provided
        if (baitVideo) {
          payload.bait_video = baitVideo;
        }
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
