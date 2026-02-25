"use server";

import { inngest } from "@/inngest/client";
import { supabaseClient } from "@/lib/supabase";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { auth } from "@/lib/auth";

export async function processVideo(uploadedFileId: string) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  const supabase = supabaseClient(session.supabaseAccessToken as string);

  const { data: uploadedFile, error: uploadedFileError } = await supabase
    .from("uploaded_files")
    .select("*")
    .eq("id", uploadedFileId)
    .single();

  if (uploadedFileError) throw uploadedFileError;

  if (uploadedFile.uploaded) return;

  inngest.send({
    name: "clip-video-events",
    data: {
      uploadedFileId: uploadedFileId,
      userId: session.user.id,
    },
  });

  const { error } = await supabase
    .from("uploaded_files")
    .update({
      uploaded: true,
    })
    .eq("id", uploadedFileId)
    .select("*")
    .single();

  if (error) throw error;
  
  return { success: true };
}

export async function getClipPlayUrl(
  clipId: string,
): Promise<{ success: boolean; url?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" };
  }

  const supabase = supabaseClient(session.supabaseAccessToken as string);
  
  try {
    const { data: clip, error: clipError } = await supabase
      .from("clips")
      .select("*")
      .eq("id", clipId)
      .single();
    if (clipError) throw clipError;

    const s3Client = new S3Client({
      region: process.env.AWS_REGION!,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });

    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: clip.s3_key,
    });

    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600,
    });

    return { success: true, url: signedUrl };
  } catch (error) {
    return { success: false, error: error as string };
  }
}