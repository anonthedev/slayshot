export type ShowcaseClip = {
  src: string;
  title: string;
  category: string;
};

/**
 * Configure private S3 video URIs with SHOWCASE_S3_URIS. The value may be a
 * JSON array or a comma/newline-separated list. URIs are signed on the server
 * before being sent to the browser, so the bucket can remain private.
 */
function getShowcaseS3Uris(): string[] {
  const raw = process.env.SHOWCASE_S3_URIS?.trim();
  if (!raw) return [];

  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every((uri) => typeof uri === "string")) {
        throw new Error("expected an array of strings");
      }
      return parsed.map((uri) => uri.trim()).filter(Boolean);
    } catch (error) {
      console.error("Invalid SHOWCASE_S3_URIS JSON:", error);
      return [];
    }
  }

  return raw
    .split(/[,\n]/)
    .map((uri) => uri.trim())
    .filter(Boolean);
}

export const SHOWCASE_S3_URIS = getShowcaseS3Uris();

export const SHOWCASE_CLIPS: ShowcaseClip[] = SHOWCASE_S3_URIS.map(
  (src, index) => ({
    src,
    title: `Slayshot cut ${String(index + 1).padStart(2, "0")}`,
    category: "Made with Slayshot",
  }),
);
