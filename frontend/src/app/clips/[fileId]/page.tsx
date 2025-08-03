import { supabaseClient } from "@/lib/supabase"
import { auth } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, FileVideo, Sparkles, Calendar, TrendingUp } from "lucide-react"
import { Clips } from "@/components/Clips"

export default async function ClipsPage({
  params,
}: {
  params: Promise<{ fileId: string }>
}) {
  const { fileId } = await params
  const session = await auth()

  if (!session?.user?.id) {
    redirect("/login")
  }

  const supabase = supabaseClient(session.supabaseAccessToken as string)

  const { data: uploadedFile, error: fileError } = await supabase
    .from("uploaded_files")
    .select("*")
    .eq("id", fileId)
    .eq("user_id", session.user.id)
    .single()

  if (fileError || !uploadedFile) {
    notFound()
  }

  const { data: clips, error: clipsError } = await supabase
    .from("clips")
    .select("*")
    .eq("uploaded_file_id", fileId)
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })

  if (clipsError) {
    throw clipsError
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <div className="mx-auto flex max-w-7xl flex-col space-y-8 px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/dashboard">
              <Button
                variant="outline"
                size="icon"
                className="bg-background/50 backdrop-blur-sm hover:bg-background/80 cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="space-y-1">
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                Your Viral Clips
              </h1>
            </div>
          </div>
        </div>

        {/* Video Info Card */}
        <Card className="border-0 bg-gradient-to-br from-card via-card to-card/50 backdrop-blur-sm shadow-xl">
          <CardHeader>
            <div className="flex items-start gap-4">
              {/* Thumbnail */}
              <div className="flex-shrink-0">
                <div className="w-32 h-18 bg-gradient-to-br from-muted/30 to-muted/50 rounded-lg overflow-hidden">
                  {uploadedFile.thumbnail ? (
                    <img
                      src={uploadedFile.thumbnail || "/placeholder.svg"}
                      alt="Video thumbnail"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <FileVideo className="h-8 w-8 text-muted-foreground/50" />
                    </div>
                  )}
                </div>
              </div>

              {/* Info */}
              <div className="flex-1 space-y-3">
                <div>
                  <Link href={uploadedFile.source_url || ""} target="_blank">
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    Original Video
                  </CardTitle>
                  </Link>
                  <CardDescription className="text-base mt-1">
                    {uploadedFile.title || "Unknown filename"}
                  </CardDescription>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Status</p>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <p className="text-sm font-medium capitalize">{uploadedFile.status}</p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Clips Generated</p>
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <p className="text-sm font-medium">{clips?.length || 0} clips</p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Created</p>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm font-medium">
                        {new Date(uploadedFile.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          hour12: true,
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Clips Section */}
        <Card className="border-0 bg-gradient-to-br from-card via-card to-card/50 backdrop-blur-sm shadow-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Generated Clips
            </CardTitle>
            <CardDescription>
              {clips?.length
                ? "Your AI-generated clips are ready! Click to play or download for social media."
                : "No clips have been generated for this video yet."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Clips clips={clips || []} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
