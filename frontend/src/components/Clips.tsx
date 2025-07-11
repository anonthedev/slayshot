"use client"

import { Download, Loader2, Play, FileVideo } from "lucide-react"
import { useEffect, useState } from "react"
import { getClipPlayUrl } from "@/actions/generations"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

interface Clip{
  id: string;
  s3_key: string;
  title: string;
  status: string;
  uploaded: boolean;
  created_at: string;
}

function ClipCard({ clip }: { clip: Clip }) {
  const [playUrl, setPlayUrl] = useState<string | null>(null)
  const [isLoadingUrl, setIsLoadingUrl] = useState(true)

  useEffect(() => {
    async function fetchPlayUrl() {
      try {
        const result = await getClipPlayUrl(clip.id)
        if (result.succes && result.url) {
          setPlayUrl(result.url)
        } else if (result.error) {
          console.error("Failed to get play url: " + result.error)
        }
      } catch (error) {
        console.error("Failed to get play url: " + error)
      } finally {
        setIsLoadingUrl(false)
      }
    }

    void fetchPlayUrl()
  }, [clip.id])

  const handleDownload = () => {
    if (playUrl) {
      const link = document.createElement("a")
      link.href = playUrl
      link.style.display = "none"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  return (
    <Card className="group overflow-hidden transition-all hover:shadow-lg my-0 py-0">
      <CardContent className="p-0">
        <div className="aspect-[9/16] bg-muted/50 relative overflow-hidden">
          {isLoadingUrl ? (
            <div className="flex h-full w-full items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading...</p>
              </div>
            </div>
          ) : playUrl ? (
            <video
              src={playUrl}
              controls
              preload="metadata"
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted/30">
              <div className="flex flex-col items-center gap-2">
                <Play className="h-12 w-12 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Failed to load</p>
              </div>
            </div>
          )}
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileVideo className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Clip</span>
            </div>
            <Button
              onClick={handleDownload}
              disabled={!playUrl}
              variant="outline"
              size="sm"
              className="gap-2 bg-transparent"
            >
              <Download className="h-4 w-4" />
              Download
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function Clips({ clips }: { clips: Clip[] }) {
  if (clips.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted p-6 mb-4">
          <FileVideo className="h-12 w-12 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No clips yet</h3>
        <p className="text-muted-foreground max-w-md">
          Upload a video or paste a YouTube URL to generate your first AI-powered clips.
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {clips.map((clip) => (
        <ClipCard key={clip.id} clip={clip} />
      ))}
    </div>
  )
}
