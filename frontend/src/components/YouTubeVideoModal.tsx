"use client";

import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Separator } from "./ui/separator";
import { toast } from "sonner";
import { X, Play, Clock } from "lucide-react";
import { processYouTubeVideo } from "@/actions/youtube";

interface YouTubeVideoDetails {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  channelTitle: string;
  publishedAt: string;
  duration: number;
  viewCount: number;
  likeCount: number;
  url: string;
}

interface YouTubeVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoUrl: string;
}

export default function YouTubeVideoModal({
  isOpen,
  onClose,
  videoUrl,
}: YouTubeVideoModalProps) {
  const [videoDetails, setVideoDetails] = useState<YouTubeVideoDetails | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [startTimeInput, setStartTimeInput] = useState("0:00");
  const [endTimeInput, setEndTimeInput] = useState("0:00");
  const [userCredits, setUserCredits] = useState(0);
  const [creditsLoading, setCreditsLoading] = useState(true);

  useEffect(() => {
    if (isOpen && videoUrl) {
      fetchVideoDetails();
      fetchUserCredits();
    }
  }, [isOpen, videoUrl]);

  useEffect(() => {
    if (videoDetails) {
      setEndTime(videoDetails.duration);
      setEndTimeInput(formatTime(videoDetails.duration));
    }
  }, [videoDetails]);

  const fetchVideoDetails = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/youtube/details", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: videoUrl }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to fetch video details");
      }

      const data = await response.json();
      setVideoDetails(data);
    } catch (error) {
      console.error("Error fetching video details:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to fetch video details"
      );
    } finally {
      setLoading(false);
    }
  };

  const fetchUserCredits = async () => {
    setCreditsLoading(true);
    try {
      const response = await fetch("/api/user/credits", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to fetch user credits");
      }

      const data = await response.json();
      setUserCredits(data.credits);
    } catch (error) {
      console.error("Error fetching user credits:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to fetch user credits"
      );
    } finally {
      setCreditsLoading(false);
    }
  };

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
        .toString()
        .padStart(2, "0")}`;
    }
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  };

  const parseTimeInput = (timeString: string): number => {
    const parts = timeString.split(":").map(Number);
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  };

  const handleStartTimeChange = (value: string) => {
    setStartTimeInput(value);
    const seconds = parseTimeInput(value);
    setStartTime(seconds);
  };

  const handleEndTimeChange = (value: string) => {
    setEndTimeInput(value);
    const seconds = parseTimeInput(value);
    setEndTime(seconds);
  };

  const calculateRequiredCredits = (): number => {
    const durationInSeconds = endTime - startTime;
    return Math.ceil(durationInSeconds / 60); // 1 credit per minute, rounded up
  };

  const hasEnoughCredits = (): boolean => {
    return userCredits >= calculateRequiredCredits();
  };

  const handleSubmit = async () => {
    if (!videoDetails) return;

    if (startTime >= endTime) {
      toast.error("Start time must be less than end time");
      return;
    }

    if (startTime < 0 || endTime > videoDetails.duration) {
      toast.error("Time range must be within video duration");
      return;
    }

    if (!hasEnoughCredits()) {
      toast.error(`Insufficient credits. You need ${calculateRequiredCredits()} credits but have ${userCredits}.`);
      return;
    }

    setProcessing(true);
    try {
      await processYouTubeVideo(videoDetails.url, startTime, endTime);

      toast.success("Video processing started successfully!");
      onClose();
    } catch (error) {
      console.error("Error processing video:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to process video"
      );
    } finally {
      setProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-xl font-semibold">YouTube Video Details</h2>
            {!creditsLoading && (
              <p className="text-sm text-muted-foreground mt-1">
                Your credits: {userCredits}
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <span className="ml-2">Loading video details...</span>
            </div>
          ) : videoDetails ? (
            <div className="space-y-6">
              {/* Video Info */}
              <div className="flex gap-4">
                <img
                  src={videoDetails.thumbnail}
                  alt={videoDetails.title}
                  className="w-48 h-27 object-cover rounded-lg"
                />
                <div className="flex-1 space-y-2">
                  <h3 className="text-lg font-semibold line-clamp-2">
                    {videoDetails.title}
                  </h3>

                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      <span>{formatTime(videoDetails.duration)}</span>
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Time Range Selection */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Set Time Range</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="start-time">Start Time</Label>
                      <Input
                        id="start-time"
                        value={startTimeInput}
                        onChange={(e) => handleStartTimeChange(e.target.value)}
                        placeholder="0:00"
                        className="font-mono"
                      />
                      <p className="text-xs text-muted-foreground">
                        Format: MM:SS or HH:MM:SS
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="end-time">End Time</Label>
                      <Input
                        id="end-time"
                        value={endTimeInput}
                        onChange={(e) => handleEndTimeChange(e.target.value)}
                        placeholder="0:00"
                        className="font-mono"
                      />
                      <p className="text-xs text-muted-foreground">
                        Format: MM:SS or HH:MM:SS
                      </p>
                    </div>
                  </div>

                  <div className="bg-muted p-3 rounded-lg">
                    <p className="text-sm">
                      <span className="font-medium">Duration:</span>{" "}
                      {formatTime(endTime - startTime)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Video length: {formatTime(videoDetails.duration)}
                    </p>
                    {creditsLoading ? (
                      <div className="mt-2 pt-2 border-t border-border">
                        <p className="text-sm text-muted-foreground">Loading credits...</p>
                      </div>
                    ) : (
                      <div className="mt-2 pt-2 border-t border-border">
                        <p className="text-sm">
                          <span className="font-medium">Credits required:</span>{" "}
                          {calculateRequiredCredits()} ({formatTime(endTime - startTime)} = {Math.ceil((endTime - startTime) / 60)} min)
                        </p>
                        <p className={`text-xs ${hasEnoughCredits() ? 'text-green-600' : 'text-red-600'}`}>
                          Your credits: {userCredits} {!hasEnoughCredits() && `(Need ${calculateRequiredCredits() - userCredits} more)`}
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Action Buttons */}
              <div className="flex gap-3 justify-end">
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={processing || startTime >= endTime || !hasEnoughCredits() || creditsLoading}
                  className="min-w-[120px]"
                >
                  {processing ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Processing...
                    </>
                  ) : !hasEnoughCredits() ? (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Insufficient Credits
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Process Video
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Failed to load video details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
