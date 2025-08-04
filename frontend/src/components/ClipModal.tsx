"use client";

import { useState, useEffect } from "react";
import { X, Sparkles, TrendingUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

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

interface ClipModalProps {
  clip: Clip;
  playUrl: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ClipModal({ clip, playUrl, isOpen, onClose }: ClipModalProps) {
  const [viralityScore, setViralityScore] = useState<number | null>(clip.virality_score ?? null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset virality score when clip changes
  useEffect(() => {
    setViralityScore(clip.virality_score ?? null);
    setError(null);
    setIsCalculating(false);
  }, [clip.id, clip.virality_score]);

  const handleCalculateVirality = async () => {
    setIsCalculating(true);
    setError(null);

    try {
      const response = await fetch("/api/calculate-virality", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clipId: clip.id,
          s3Key: clip.s3_key,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to calculate virality");
      }

      const data = await response.json();
      
      if (data.success) {
        // Start polling for the result
        pollForViralityScore();
      } else {
        throw new Error(data.error || "Failed to calculate virality");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsCalculating(false);
    }
  };

  const pollForViralityScore = async () => {
    const maxAttempts = 30; // Poll for up to 5 minutes (30 * 10s)
    let attempts = 0;

    const poll = async () => {
      try {
        const response = await fetch(`/api/clips/${clip.id}/virality`);
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.virality_score !== null) {
            setViralityScore(data.virality_score);
            setIsCalculating(false);
            return;
          }
        }

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 10000); // Poll every 10 seconds
        } else {
          setError("Virality calculation timed out. Please try again.");
          setIsCalculating(false);
        }
      } catch (err) {
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 10000);
        } else {
          setError("Failed to get virality score. Please try again.");
          setIsCalculating(false);
        }
      }
    };

    poll();
  };

  const getViralityColor = (score: number) => {
    if (score >= 8) return "text-green-500";
    if (score >= 6) return "text-yellow-500";
    if (score >= 4) return "text-orange-500";
    return "text-red-500";
  };

  const getViralityLabel = (score: number) => {
    if (score >= 8) return "Viral Potential";
    if (score >= 6) return "Good Engagement";
    if (score >= 4) return "Moderate Appeal";
    return "Low Virality";
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <Card className="relative w-full max-w-6xl mx-4 max-h-[90vh] overflow-hidden border-0 bg-gradient-to-br from-card via-card to-card/95 backdrop-blur-sm shadow-2xl">
        {/* Close Button */}
        <Button
          onClick={onClose}
          size="icon"
          variant="ghost"
          className="absolute top-4 right-4 z-10 h-8 w-8 rounded-full bg-black/20 hover:bg-black/40 text-white"
        >
          <X className="h-4 w-4" />
        </Button>

        <CardContent className="p-0">
          <div className="flex flex-col lg:flex-row h-full min-h-[70vh]">
            {/* Left Side - Video */}
            <div className="flex-1 lg:flex-[2] bg-black relative">
              <div className="aspect-[9/16] lg:aspect-video w-full h-full">
                <video
                  src={playUrl}
                  controls
                  className="w-full h-full object-contain"
                  controlsList="nodownload"
                />
              </div>
            </div>

            {/* Right Side - Virality Analysis */}
            <div className="flex-1 p-8 flex flex-col justify-center space-y-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-gradient-to-r from-primary/10 to-primary/5 p-3">
                    <Sparkles className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">Clip Analysis</h3>
                    <p className="text-sm text-muted-foreground">
                      AI-powered virality assessment
                    </p>
                  </div>
                </div>

                {/* Virality Score Display */}
                {viralityScore !== null && (
                  <div className="space-y-4">
                    <div className="text-center space-y-2">
                      <div className="text-6xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                        {viralityScore}
                        <span className="text-lg text-muted-foreground">/10</span>
                      </div>
                      <div className={`text-lg font-semibold ${getViralityColor(viralityScore)}`}>
                        {getViralityLabel(viralityScore)}
                      </div>
                    </div>

                    {/* Score Breakdown */}
                    <div className="space-y-2">
                      <div className="w-full bg-muted rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full transition-all duration-500 ${
                            viralityScore >= 8 ? 'bg-green-500' :
                            viralityScore >= 6 ? 'bg-yellow-500' :
                            viralityScore >= 4 ? 'bg-orange-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${(viralityScore / 10) * 100}%` }}
                        />
                      </div>
                      <p className="text-sm text-muted-foreground text-center">
                        Based on content analysis, emotional impact, and engagement potential
                      </p>
                    </div>
                  </div>
                )}

                {/* Error Display */}
                {error && (
                  <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
                    <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
                  </div>
                )}

                                 {/* Calculate Button */}
                <Button
                  onClick={handleCalculateVirality}
                  disabled={isCalculating}
                  className="w-full bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary/80 shadow-lg hover:shadow-xl transition-all duration-200"
                  size="lg"
                >
                  {isCalculating ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <TrendingUp className="h-5 w-5 mr-2" />
                      {viralityScore !== null ? "Recalculate Virality" : "Calculate Virality"}
                    </>
                  )}
                </Button>

                {/* Info */}
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>• Analyzes speech content and emotional impact</p>
                  <p>• Considers engagement and shareability factors</p>
                  <p>• Provides actionable insights for optimization</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 