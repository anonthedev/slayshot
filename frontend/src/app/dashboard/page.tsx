import Dashboard from "@/components/Dashboard";
import { supabaseClient } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await auth();
  
  if (!session?.user?.id) {
    redirect("/login");
  }
  
  const supabase = supabaseClient(session.supabaseAccessToken as string);
  
  // Get uploaded files with clip counts
  const { data: uploadedFiles, error: uploadedFilesError } = await supabase
    .from("uploaded_files")
    .select(`
      id,
      s3_key,
      title,
      status,
      created_at,
      uploaded,
      clips:clips(count)
    `)
    .eq("user_id", session.user.id)
    .eq("uploaded", true);
  
  if (uploadedFilesError) {
    throw uploadedFilesError;
  }
  
  const formattedFiles = uploadedFiles?.map((file) => ({
    id: file.id,
    s3Key: file.s3_key,
    filename: file.title ?? "Unknown filename",
    status: file.status,
    clipsCount: file.clips[0]?.count ?? 0,
    createdAt: new Date(file.created_at),
  })) || [];
  
  return (
    <section className="w-full h-full">
      <Dashboard uploadedFiles={formattedFiles} />
    </section>
  );
}
