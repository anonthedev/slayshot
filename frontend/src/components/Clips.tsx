"use client";

import { Download, FileVideo, Sparkles, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { getClipPlayUrl } from "@/actions/generations";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ClipModal } from "@/components/ClipModal";

interface Clip {
  id: string;
  s3_key: string;
  title: string;
  status: string;
  uploaded: boolean;
  created_at: string;
  virality_score?: number | null;
  transcript?: string | null;
}

function ClipCard({ clip, index, onOpenModal }: { clip: Clip; index: number; onOpenModal: (clip: Clip, playUrl: string) => void }) {
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [isLoadingUrl, setIsLoadingUrl] = useState(true);

  useEffect(() => {
    async function fetchPlayUrl() {
      try {
        const result = await getClipPlayUrl(clip.id);
        if (result.success && result.url) {
          setPlayUrl(result.url);
        } else if (result.error) {
          console.error("Failed to get play url: " + result.error);
        }
      } catch (error) {
        console.error("Failed to get play url: " + error);
      } finally {
        setIsLoadingUrl(false);
      }
    }

    void fetchPlayUrl();
  }, [clip.id]);

  // Get video duration when video loads
  useEffect(() => {
    if (playUrl) {
      const video = document.createElement('video');
      video.src = playUrl;
      video.addEventListener('loadedmetadata', () => {
        const duration = Math.floor(video.duration);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        const durationElement = document.getElementById(`duration-${clip.id}`);
        if (durationElement) {
          durationElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
      });
      video.load();
    }
  }, [playUrl, clip.id]);

  const handleCardClick = () => {
    if (playUrl) {
      onOpenModal(clip, playUrl);
    }
  };

  return (
    <Card
      className="group overflow-hidden transition-all duration-300 hover:shadow-2xl hover:shadow-primary/10 border-0 bg-gradient-to-br from-card via-card to-card/50 backdrop-blur-sm hover:scale-[1.02]"
    >
      <div className="relative">
        <div className="aspect-[9/16] bg-gradient-to-br from-muted/30 to-muted/50 relative overflow-hidden rounded-t-lg">
          {isLoadingUrl ? (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/5 to-primary/10">
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin"></div>
                  <Sparkles className="absolute inset-0 m-auto h-5 w-5 text-primary" />
                </div>
                <p className="text-sm font-medium text-primary">
                  Loading clip...
                </p>
              </div>
            </div>
          ) : playUrl ? (
            <>
              <video
                src={playUrl}
                controls
                preload="metadata"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                controlsList="nodownload"
              />
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950/20 dark:to-red-900/20">
              <div className="flex flex-col items-center gap-3">
                <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-4">
                  <FileVideo className="h-8 w-8 text-red-500" />
                </div>
                <p className="text-sm font-medium text-red-600 dark:text-red-400">
                  Failed to load
                </p>
              </div>
            </div>
          )}

                     {/* Duration badge */}
           <div className="absolute top-3 right-3">
             <div className="rounded-full bg-black/70 backdrop-blur-sm px-2 py-1 text-white text-xs font-medium flex items-center gap-1">
               <Clock className="h-3 w-3" />
               <span id={`duration-${clip.id}`}>--:--</span>
             </div>
           </div>
        </div>

        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-base font-semibold">
                  Clip {index + 1}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {new Date(clip.created_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}
              </p>
            </div>

            <Button
              onClick={handleCardClick}
              disabled={!playUrl}
              size="icon"
              className="cursor-pointer bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary/80 shadow-lg hover:shadow-xl transition-all duration-200 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </div>
    </Card>
  );
}

export function Clips({ clips }: { clips: Clip[] }) {
  const [selectedClip, setSelectedClip] = useState<{ clip: Clip; playUrl: string } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpenModal = (clip: Clip, playUrl: string) => {
    setSelectedClip({ clip, playUrl });
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedClip(null);
  };

  if (clips.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="space-y-6">
          <div className="rounded-full bg-gradient-to-br from-primary/10 to-primary/5 p-8 mx-auto w-fit">
            <div className="rounded-full bg-gradient-to-br from-primary/20 to-primary/10 p-6">
              <Sparkles className="h-16 w-16 text-primary/60" />
            </div>
          </div>
          <div className="space-y-3 max-w-md">
            <h3 className="text-2xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              No clips generated yet
            </h3>
            <p className="text-muted-foreground leading-relaxed">
              Your AI-powered clips will appear here once processing is
              complete. This usually takes just a few minutes!
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-full px-4 py-2 w-fit mx-auto">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <span>Processing in progress...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Clips Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-8">
        {clips.map((clip, index) => (
          <ClipCard key={clip.id} clip={clip} index={index} onOpenModal={handleOpenModal} />
        ))}
      </div>

      {/* Footer info */}
      <div className="text-center pt-8 border-t border-border/50">
        <p className="text-sm text-muted-foreground">
          All clips are optimized for social media platforms • 9:16 aspect ratio
          • HD quality
        </p>
      </div>

      {selectedClip && isModalOpen && (
        <>
          {typeof window !== 'undefined' && (
            <div className="absolute inset-0 z-[9999]">
              <ClipModal
                clip={selectedClip.clip}
                playUrl={selectedClip.playUrl}
                isOpen={isModalOpen}
                onClose={handleCloseModal}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
