"use server";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { supabaseClient } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

export async function generateUploadUrl(fileInfo: {
  filename: string;
  contentType: string;
}): Promise<{
  success: boolean;
  signedUrl: string;
  key: string;
  uploadedFileId: string;
}> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  const supabase = supabaseClient(session.supabaseAccessToken as string);

  const s3Client = new S3Client({
    region: process.env.AWS_REGION!,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  const fileExtension = fileInfo.filename.split(".").pop() ?? "";

  const uniqueId = uuidv4();
  const key = `${uniqueId}/original.${fileExtension}`;

  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: key,
    ContentType: fileInfo.contentType,
  });

  const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 600 });

  const { data: uploadedFileDBRecord, error } = await supabase
    .from("uploaded_files")
    .insert({
      user_id: session.user.id,
      s3_key: key,
      title: fileInfo.filename,
      uploaded: false,
    })
    .select("id")
    .single();

  console.log(uploadedFileDBRecord);

  if (error) {
    console.log(error);
    return {
      success: false,
      signedUrl: "",
      key: "",
      uploadedFileId: "",
    };
  }

  return {
    success: true,
    signedUrl,
    key,
    uploadedFileId: uploadedFileDBRecord?.id,
  };
}
