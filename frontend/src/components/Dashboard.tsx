"use client";

import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Loader2,
  Youtube,
  FileVideo,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import YouTubeVideoModal from "./YouTubeVideoModal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";

export default function Dashboard({
  uploadedFiles,
}: {
  uploadedFiles: {
    id: string;
    s3Key: string;
    filename: string;
    status: string;
    clipsCount: number;
    createdAt: Date;
  }[];
}) {
  // const [files, setFiles] = useState<File[]>([]);
  // const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isYouTubeModalOpen, setIsYouTubeModalOpen] = useState(false);
  // const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleRefresh = async () => {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 600);
  };

  // const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
  //   const selectedFiles = event.target.files;
  //   if (selectedFiles && selectedFiles.length > 0) {
  //     setFiles(Array.from(selectedFiles));
  //   }
  // };

  // const handleFileButtonClick = () => {
  //   fileInputRef.current?.click();
  // };

  // const handleUpload = async () => {
  //   if (files.length === 0) return;

  //   const file = files[0]!;
  //   setUploading(true);

  //   try {
  //     const { success, signedUrl, uploadedFileId } = await generateUploadUrl({
  //       filename: file.name,
  //       contentType: file.type,
  //     });

  //     if (!success) throw new Error("Failed to get upload URL");

  //     const uploadResponse = await fetch(signedUrl, {
  //       method: "PUT",
  //       body: file,
  //       headers: {
  //         "Content-Type": file.type,
  //       },
  //     });

  //     if (!uploadResponse.ok)
  //       throw new Error(`Upload filed with status: ${uploadResponse.status}`);

  //     const result = await processVideo(uploadedFileId);
  //     console.log("Process result:", result);

  //     setFiles([]);

  //     toast.success("Video uploaded successfully", {
  //       description:
  //         "Your video has been scheduled for processing. Check the status below.",
  //       duration: 5000,
  //     });
  //   } catch (error) {
  //     console.error("Upload failed:", error);
  //     toast.error("Upload failed", {
  //       description:
  //         "There was a problem uploading your video. Please try again.",
  //     });
  //   } finally {
  //     setUploading(false);
  //   }
  // };

  const handleYouTubeSubmit = () => {
    if (!youtubeUrl.trim()) {
      toast.error("Please enter a YouTube URL");
      return;
    }

    // Improved validation for all YouTube URL formats
    const youtubeRegex = /^(https?:\/\/)?((www|m)\.)?(youtube\.com\/(watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)[a-zA-Z0-9_-]{11}/;
    if (!youtubeRegex.test(youtubeUrl)) {
      toast.error("Please enter a valid YouTube URL");
      return;
    }

    setIsYouTubeModalOpen(true);
  };

  const handleCloseYouTubeModal = () => {
    setIsYouTubeModalOpen(false);
    setYoutubeUrl("");
    handleRefresh();
  };

  const handleRowClick = (item: { id: string; clipsCount: number }) => {
    if (item.clipsCount > 0) {
      router.push(`/dashboard/clips/${item.id}`);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "queued":
        return <Clock className="h-4 w-4" />;
      case "processing":
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case "processed":
        return <CheckCircle className="h-4 w-4" />;
      case "failed":
        return <XCircle className="h-4 w-4" />;
      case "no credits":
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "processed":
        return "default";
      case "processing":
        return "secondary";
      case "failed":
      case "no credits":
        return "destructive";
      default:
        return "outline";
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-6xl flex-col space-y-8 px-6 py-12">
        <div className="space-y-6">
          <Card className="border-2 border-dashed border-muted-foreground/25 bg-card/50">
            <CardHeader className="text-center pb-4">
              <CardTitle className="text-2xl flex items-center justify-center gap-2">
                <Youtube className="h-6 w-6 text-red-500" />
                Process Video
              </CardTitle>
              <CardDescription className="text-base">
                Paste a YouTube URL or upload a video file to generate clips
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="youtube-url" className="text-sm font-medium">
                  YouTube URL or Upload File
                </Label>
                <div className="flex flex-row gap-3 items-center">
                  <Input
                    id="youtube-url"
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    className="flex-1 text-base"
                  />
                  <Button
                    size="lg"
                    disabled={!youtubeUrl.trim()}
                    onClick={handleYouTubeSubmit}
                    className="px-8 gap-2"
                  >
                    <Youtube className="h-4 w-4" />
                    Get Details
                  </Button>
                </div>
              </div>
              {/* <Button
                variant="outline"
                size="icon"
                onClick={handleFileButtonClick}
                disabled={uploading}
                className=""
              >
                <Upload className="h-3 w-3" />
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4"
                onChange={handleFileSelect}
                className="hidden"
              />
              {files.length > 0 && (
                <div className="flex items-center justify-between pt-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <FileVideo className="h-4 w-4" />
                    <span>{files[0]?.name}</span>
                    <span>
                      ({(files[0]?.size / (1024 * 1024)).toFixed(1)} MB)
                    </span>
                  </div>
                  <Button
                    disabled={uploading}
                    onClick={handleUpload}
                    className="gap-2"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Generate Clips
                      </>
                    )}
                  </Button>
                </div>
              )} */}
            </CardContent>
          </Card>

          {uploadedFiles.length > 0 && (
            <Card>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Processing Queue</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="gap-2 bg-transparent"
                  >
                    {refreshing && <Loader2 className="h-4 w-4 animate-spin" />}
                    Refresh
                  </Button>
                </div>
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>File</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Clips</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {uploadedFiles.map((item) => (
                          <TableRow
                            key={item.id}
                            className={
                              item.clipsCount > 0
                                ? "cursor-pointer hover:bg-muted/50 transition-colors"
                                : ""
                            }
                            onClick={() => handleRowClick(item)}
                          >
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                <FileVideo className="h-4 w-4 text-muted-foreground" />
                                <span className="max-w-xs truncate">
                                  {item.filename}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {new Date(item.createdAt).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={getStatusVariant(item.status)}
                                className="gap-1"
                              >
                                {getStatusIcon(item.status)}
                                {item.status.charAt(0).toUpperCase() +
                                  item.status.slice(1)}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {item.clipsCount > 0 ? (
                                <span className="font-medium text-primary">
                                  {item.clipsCount} clip
                                  {item.clipsCount !== 1 ? "s" : ""} →
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <YouTubeVideoModal
        isOpen={isYouTubeModalOpen}
        onClose={handleCloseYouTubeModal}
        videoUrl={youtubeUrl}
      />
    </div>
  );
}
