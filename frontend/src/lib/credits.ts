import type { LayoutType } from "@/lib/constants";

export function calculateRequiredCredits(
  startTime: number,
  endTime: number,
  layout: LayoutType,
): number {
  const durationInSeconds = endTime - startTime;
  const baseCredits = Math.ceil(durationInSeconds / 60);
  const splitSurcharge = layout === "split" ? 5 : 0;

  return baseCredits + splitSurcharge;
}

export function validateProcessingRange(
  startTime: number,
  endTime: number,
  videoDuration: number,
): void {
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    !Number.isFinite(videoDuration)
  ) {
    throw new Error("Video times must be finite numbers");
  }

  if (startTime < 0 || endTime <= startTime) {
    throw new Error("Invalid video time range");
  }

  if (videoDuration <= 0 || endTime > videoDuration) {
    throw new Error("Video time range exceeds the source duration");
  }
}
