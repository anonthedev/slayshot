"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Film,
  Maximize2,
  Volume2,
  VolumeX,
  Pause,
  Play,
} from "lucide-react";
import type { ShowcaseClip } from "@/lib/showcase-clips";

type ClipShowcaseProps = {
  clips: ShowcaseClip[];
};

const CATALOG_PAGE_SIZE = 9;

export default function ClipShowcase({ clips }: ClipShowcaseProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [catalogPage, setCatalogPage] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  const activeClip = clips[activeIndex];
  const pageCount = Math.max(
    1,
    Math.ceil(clips.length / CATALOG_PAGE_SIZE),
  );
  const visibleClips = clips.slice(
    catalogPage * CATALOG_PAGE_SIZE,
    (catalogPage + 1) * CATALOG_PAGE_SIZE,
  );

  useEffect(() => {
    setCatalogPage(Math.floor(activeIndex / CATALOG_PAGE_SIZE));
  }, [activeIndex]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeClip) return;

    video.load();
    void video.play().catch(() => setIsPlaying(false));
  }, [activeClip]);

  if (!activeClip) {
    return (
      <div className="grid min-h-[32rem] place-items-center rounded-3xl border border-dashed border-white/15 bg-white/[0.02] px-6 text-center">
        <div className="max-w-md">
          <span className="mx-auto mb-6 grid size-14 place-items-center rounded-2xl border border-[#c7ff35]/25 bg-[#c7ff35]/[0.07] text-[#c7ff35]">
            <Film className="size-6" />
          </span>
          <h3 className="text-2xl font-semibold tracking-tight text-white">
            Showcase cuts coming soon
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-white/45">
            Add S3 video URIs to the showcase array and they will appear here
            automatically.
          </p>
        </div>
      </div>
    );
  }

  const selectClip = (index: number) => {
    setActiveIndex(index);
  };

  const moveCatalogPage = (direction: number) => {
    const nextPage = Math.min(
      pageCount - 1,
      Math.max(0, catalogPage + direction),
    );
    if (nextPage === catalogPage) return;

    setCatalogPage(nextPage);
    setActiveIndex(nextPage * CATALOG_PAGE_SIZE);
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      void video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const toggleMuted = () => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  return (
    <div className="relative">
      <div className="landing-video-shell">
        <div className="landing-video-stage">
          <video
            ref={videoRef}
            src={activeClip.src}
            className="h-full w-full object-contain"
            autoPlay
            muted={isMuted}
            loop
            playsInline
            preload="metadata"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onVolumeChange={(event) => setIsMuted(event.currentTarget.muted)}
            aria-label={`${activeClip.title}, a clip made with Slayshot`}
          />

          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/20" />

          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 sm:p-5">
            <span className="rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-white backdrop-blur-md">
              Made with Slayshot
            </span>
            <button
              type="button"
              onClick={() => videoRef.current?.requestFullscreen()}
              className="grid size-9 place-items-center rounded-full border border-white/15 bg-black/45 text-white transition hover:scale-105 hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c7ff35]"
              aria-label="View video fullscreen"
            >
              <Maximize2 className="size-4" />
            </button>
          </div>

          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-4 sm:p-6">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#c7ff35]">
                {activeClip.category}
              </p>
              <h3 className="max-w-sm text-xl font-semibold tracking-tight text-white sm:text-2xl">
                {activeClip.title}
              </h3>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={toggleMuted}
                className="grid size-12 place-items-center rounded-full border border-white/15 bg-black/55 text-white backdrop-blur-md transition hover:scale-105 hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                aria-label={isMuted ? "Unmute video" : "Mute video"}
              >
                {isMuted ? (
                  <VolumeX className="size-4" />
                ) : (
                  <Volume2 className="size-4" />
                )}
              </button>
              <button
                type="button"
                onClick={togglePlayback}
                className="grid size-12 place-items-center rounded-full bg-[#c7ff35] text-black transition hover:scale-105 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                aria-label={isPlaying ? "Pause video" : "Play video"}
              >
                {isPlaying ? (
                  <Pause className="size-4 fill-current" />
                ) : (
                  <Play className="ml-0.5 size-4 fill-current" />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="landing-video-catalog flex flex-col gap-4 border-t border-white/10 bg-[#111] p-5 lg:border-l lg:border-t-0 lg:p-6">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-5 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                Selected cuts
              </p>
              <span className="font-mono text-xs text-white/35">
                {String(activeIndex + 1).padStart(2, "0")} /{" "}
                {String(clips.length).padStart(2, "0")}
              </span>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-3 gap-x-2 gap-y-4">
              {visibleClips.map((clip, pageIndex) => {
                const index =
                  catalogPage * CATALOG_PAGE_SIZE + pageIndex;

                return (
                <button
                  type="button"
                  key={`${clip.src}-${index}`}
                  onClick={() => selectClip(index)}
                  aria-label={`Play ${clip.title}`}
                  aria-current={index === activeIndex ? "true" : undefined}
                  className={`group relative min-h-0 overflow-hidden rounded-xl border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c7ff35] ${
                    index === activeIndex
                      ? "border-[#c7ff35]"
                      : "border-white/10 opacity-55 hover:opacity-100"
                  }`}
                >
                  <video
                    src={clip.src}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    muted
                    playsInline
                    preload="metadata"
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 pt-8 text-left text-[10px] font-medium text-white">
                    {clip.category}
                  </span>
                </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/10 pt-5">
            <p className="max-w-[14rem] text-xs leading-relaxed text-white/45">
              Real clips, cut from long-form video.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => moveCatalogPage(-1)}
                disabled={catalogPage === 0}
                className="grid size-10 place-items-center rounded-full border border-white/15 text-white transition hover:border-white/40 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c7ff35] disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:border-white/15 disabled:hover:bg-transparent"
                aria-label="Previous catalog page"
              >
                <ArrowLeft className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => moveCatalogPage(1)}
                disabled={catalogPage === pageCount - 1}
                className="grid size-10 place-items-center rounded-full bg-white text-black transition hover:bg-[#c7ff35] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c7ff35] disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-white"
                aria-label="Next catalog page"
              >
                <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
