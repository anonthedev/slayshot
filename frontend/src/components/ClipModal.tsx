"use client";


import { X, Sparkles, Download } from "lucide-react";
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
  const viralityScore = clip.virality_score ?? null;

  const handleDownload = () => {
    if (playUrl) {
      const link = document.createElement("a");
      link.href = playUrl;
      link.download = `clip-${clip.id}.mp4`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <Card className="py-0 my-0 relative max-w-4xl w-full overflow-hidden border-0 backdrop-blur-sm shadow-2xl">
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
          <div className="flex h-[600px]">
            {/* Left Side - Video */}
            <div className="bg-black flex items-center justify-center">
              <video
                src={playUrl}
                controls
                muted
                autoPlay
                className="h-full aspect-[9/16] object-cover"
                controlsList="nodownload"
              />
            </div>

            {/* Right Side - Virality Analysis */}
            <div className="flex-1 p-6 flex flex-col justify-start space-y-4 overflow-y-auto">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-gradient-to-r from-primary/10 to-primary/5 p-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">Clip Analysis</h3>
                    <p className="text-xs text-muted-foreground">
                      AI-powered virality assessment
                    </p>
                  </div>
                </div>

                {/* Virality Score Display */}
                {viralityScore !== null ? (
                  <div className="space-y-3">
                    <div className="text-center space-y-1">
                      <div className="text-5xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                        {viralityScore}
                        <span className="text-base text-muted-foreground">/10</span>
                      </div>
                      <div className={`text-base font-semibold ${getViralityColor(viralityScore)}`}>
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
                      <p className="text-xs text-muted-foreground text-center">
                        Based on content analysis, emotional impact, and engagement potential
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center space-y-2 py-6">
                    <div className="text-muted-foreground">
                      <Sparkles className="h-10 w-10 mx-auto mb-2 opacity-50" />
                      <p className="text-base font-medium">No Virality Score</p>
                      <p className="text-xs">Score will be available for new clips</p>
                    </div>
                  </div>
                )}

                {/* Transcript Display */}
                {clip.transcript && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-muted-foreground">Transcript</h4>
                    <div className="p-3 rounded-lg bg-muted/50 max-h-24 overflow-y-auto">
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {clip.transcript}
                      </p>
                    </div>
                  </div>
                )}

                {/* Download Button */}
                <Button
                  onClick={handleDownload}
                  className="w-full bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary/80 shadow-lg hover:shadow-xl transition-all duration-200"
                  size="lg"
                >
                  <Download className="h-5 w-5 mr-2" />
                  Download Clip
                </Button>

                {/* Info */}
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>• Virality score calculated during clip generation</p>
                  <p>• Based on content analysis and engagement potential</p>
                  <p>• View transcript and download high-quality clip</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 