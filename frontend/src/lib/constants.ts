export const LAYOUT_OPTIONS = [
  { value: "full", label: "Full Screen" },
  { value: "split", label: "Split Screen" }
] as const;

export const BAIT_VIDEO_OPTIONS = [
  { value: "minecraft_night", label: "Minecraft" },
  { value: "subway_surfer", label: "Subway Surfer" }
] as const;

export type LayoutType = typeof LAYOUT_OPTIONS[number]["value"];
export type BaitVideoType = typeof BAIT_VIDEO_OPTIONS[number]["value"]; 