import { supabaseClient } from "@/lib/supabase";
import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, FileVideo } from "lucide-react";
import { Clips } from "@/components/Clips";

export default async function ClipsPage({ params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const session = await auth();
  
  if (!session?.user?.id) {
    redirect("/login");
  }
  
  const supabase = supabaseClient(session.supabaseAccessToken as string);
  
  const { data: uploadedFile, error: fileError } = await supabase
    .from("uploaded_files")
    .select("*")
    .eq("id", fileId)
    .eq("user_id", session.user.id)
    .single();
  
  if (fileError || !uploadedFile) {
    notFound();
  }
  
  const { data: clips, error: clipsError } = await supabase
    .from("clips")
    .select("*")
    .eq("uploaded_file_id", fileId)
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false });
    
  if (clipsError) {
    throw clipsError;
  }
  
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-6xl flex-col space-y-8 px-6 py-12">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/dashboard">
              <Button variant="outline" size="icon" >
                <ArrowLeft className="h-3 w-3" />
              </Button>
            </Link>
            <div className="space-y-2">
              <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                Generated Clips
              </h1>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileVideo className="h-5 w-5" />
              File Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Filename</p>
                <p className="text-base font-medium">{uploadedFile.title || 'Unknown filename'}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Status</p>
                <p className="text-base font-medium capitalize">{uploadedFile.status}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Upload Date</p>
                <p className="text-base font-medium">
                  {new Date(uploadedFile.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileVideo className="h-5 w-5" />
              Generated Clips ({clips?.length || 0})
            </CardTitle>
            <CardDescription>
              {clips?.length 
                ? "Click on any clip to play it, or use the download button to save it locally."
                : "No clips have been generated for this file yet."
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Clips clips={clips || []} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 