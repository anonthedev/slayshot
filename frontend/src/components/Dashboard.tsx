"use client"

import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { FileVideo, Clock, AlertCircle, Check, X, Sparkles, TrendingUp, Play, RefreshCw } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import YouTubeVideoModal from "./YouTubeVideoModal"

import { Badge } from "@/components/ui/badge"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"

export default function Dashboard({
  uploadedFiles,
}: {
  uploadedFiles: {
    id: string
    s3Key: string
    filename: string
    thumbnail?: string | null
    status: string
    clipsCount: number
    createdAt: Date
  }[]
}) {
  const [refreshing, setRefreshing] = useState(false)
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const [isYouTubeModalOpen, setIsYouTubeModalOpen] = useState(false)
  const router = useRouter()

  const handleRefresh = async () => {
    setRefreshing(true)
    router.refresh()
    setTimeout(() => setRefreshing(false), 600)
  }

  const handleYouTubeSubmit = () => {
    if (!youtubeUrl.trim()) {
      toast.error("Please enter a YouTube URL")
      return
    }

    const youtubeRegex =
      /^(https?:\/\/)?((www|m)\.)?(youtube\.com\/(watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)[a-zA-Z0-9_-]{11}/
    if (!youtubeRegex.test(youtubeUrl)) {
      toast.error("Please enter a valid YouTube URL")
      return
    }

    setIsYouTubeModalOpen(true)
  }

  const handleCloseYouTubeModal = () => {
    setIsYouTubeModalOpen(false)
    setYoutubeUrl("")
    handleRefresh()
  }

  const handleRowClick = (item: { id: string; clipsCount: number; thumbnail?: string | null }) => {
    if (item.clipsCount > 0) {
      router.push(`/clips/${item.id}`)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "queued":
        return <Clock className="h-3.5 w-3.5" />
      case "processing":
        return (
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <span>Processing</span>
          </div>
        )
      case "processed":
        return <Check className="h-3.5 w-3.5 text-green-500" />
      case "failed":
        return <X className="h-3.5 w-3.5 text-red-500" />
      case "no credits":
        return <AlertCircle className="h-3.5 w-3.5 text-orange-500" />
      default:
        return <Clock className="h-3.5 w-3.5" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "processed":
        return "text-green-600 bg-green-50 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800"
      case "processing":
        return "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800"
      case "failed":
        return "text-red-600 bg-red-50 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800"
      case "no credits":
        return "text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-950 dark:text-orange-400 dark:border-orange-800"
      default:
        return "text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-950 dark:text-gray-400 dark:border-gray-800"
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 font-inter">
      <div className="mx-auto flex max-w-7xl flex-col space-y-8 px-6 py-8">
        {/* Upload Section */}
        <Card className="border-2 border-dashed border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 backdrop-blur-sm">
          <CardHeader className="text-center pb-6">
            <CardTitle className="text-2xl bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              Create Viral Clips
            </CardTitle>
            <CardDescription className="text-base max-w-md mx-auto">
              Paste your YouTube URL and let our AI find the most engaging moments for your audience
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label htmlFor="youtube-url" className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                YouTube URL
              </Label>
              <div className="flex gap-3">
                <Input
                  id="youtube-url"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  className="flex-1 h-12 text-base bg-background/50 backdrop-blur-sm border-primary/20 focus:border-primary/40"
                />
                <Button
                  size="lg"
                  disabled={!youtubeUrl.trim()}
                  onClick={handleYouTubeSubmit}
                  className="px-8 h-12 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary/80 shadow-lg hover:shadow-xl transition-all duration-200"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate Clips
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Videos Grid */}
        {uploadedFiles.length > 0 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight">Your Videos</h2>
                <p className="text-muted-foreground">
                  {uploadedFiles.length} video{uploadedFiles.length !== 1 ? "s" : ""} processed
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing}
                className="gap-2 bg-background/50 backdrop-blur-sm hover:bg-background/80"
              >
                <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                Refresh
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {uploadedFiles.map((item) => (
                <Card
                  key={item.id}
                  className={cn(
                    "my-0 py-0 group overflow-hidden transition-all duration-300 hover:shadow-xl border-0 bg-gradient-to-br from-card via-card to-card/50 backdrop-blur-sm",
                    item.clipsCount > 0
                      ? "cursor-pointer hover:scale-[1.02] hover:shadow-2xl hover:shadow-primary/10"
                      : "",
                  )}
                  onClick={() => handleRowClick(item)}
                >
                  <div className="relative">
                    {/* Thumbnail */}
                    <div className="aspect-video bg-gradient-to-br from-muted/50 to-muted/30 rounded-t-lg overflow-hidden relative">
                      {item.thumbnail ? (
                        <img
                          src={item.thumbnail || "/placeholder.svg"}
                          alt="Video thumbnail"
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted/30 to-muted/50">
                          <FileVideo className="h-12 w-12 text-muted-foreground/50" />
                        </div>
                      )}

                      {/* Play overlay for completed videos */}
                      {item.clipsCount > 0 && (
                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                          <div className="rounded-full bg-white/90 p-3 transform scale-90 group-hover:scale-100 transition-transform duration-300">
                            <Play className="h-6 w-6 text-gray-900 ml-0.5" />
                          </div>
                        </div>
                      )}

                      {/* Status badge */}
                      <div className="absolute top-3 right-3">
                        <Badge className={cn("text-xs font-medium border shadow-sm", getStatusColor(item.status))}>
                          {item.status === "processing" ? (
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 bg-current rounded-full animate-pulse"></div>
                              Processing
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              {getStatusIcon(item.status)}
                              {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                            </div>
                          )}
                        </Badge>
                      </div>
                    </div>

                    {/* Processing Overlay */}
                    {item.status === "processing" && (
                      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm rounded-lg flex items-center justify-center z-10">
                        <div className="text-center p-6 max-w-xs">
                          <div className="flex justify-center mb-4">
                            <div className="relative">
                              <div className="w-12 h-12 rounded-full border-4 border-white/20 border-t-white animate-spin"></div>
                              <Sparkles className="absolute inset-0 m-auto h-5 w-5 text-white" />
                            </div>
                          </div>
                          <h3 className="text-white font-semibold mb-2">Processing...</h3>
                          <p className="text-white/80 text-sm leading-relaxed">
                            This might take some time, you can close the tab.
                          </p>
                        </div>
                      </div>
                    )}

                    <CardContent className="p-4 space-y-3">
                      {/* Title */}
                      <h3 className="font-semibold text-sm line-clamp-2 leading-tight group-hover:text-primary transition-colors duration-200">
                        {item.filename}
                      </h3>

                      {/* Stats */}
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {new Date(item.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          })}
                        </span>
                        {item.clipsCount > 0 && (
                          <div className="flex items-center gap-1 text-primary font-medium">
                            <Sparkles className="h-3 w-3" />
                            {item.clipsCount} clip{item.clipsCount !== 1 ? "s" : ""}
                          </div>
                        )}
                      </div>

                      {/* Action indicator */}
                      {item.clipsCount > 0 && (
                        <div className="pt-2 border-t border-border/50">
                          <div className="flex items-center gap-2 text-xs font-medium text-primary">
                            <Play className="h-3 w-3" />
                            View clips
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {uploadedFiles.length === 0 && (
          <Card className="border-dashed border-2 border-muted-foreground/25 bg-gradient-to-br from-muted/20 via-transparent to-muted/20">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-4">
              <div className="rounded-full bg-gradient-to-br from-primary/10 to-primary/5 p-6">
                <FileVideo className="h-12 w-12 text-primary/60" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">Ready to create viral content?</h3>
                <p className="text-muted-foreground max-w-md">
                  Paste a YouTube URL above to get started. Our AI will analyze your video and create engaging clips
                  automatically.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <YouTubeVideoModal isOpen={isYouTubeModalOpen} onClose={handleCloseYouTubeModal} videoUrl={youtubeUrl} />
    </div>
  )
}
