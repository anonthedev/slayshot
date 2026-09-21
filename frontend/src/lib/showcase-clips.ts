export type ShowcaseClip = {
  src: string;
  title: string;
  category: string;
};

/**
 * Add private S3 video URIs here. They are signed on the server before being
 * sent to the browser, so the bucket can remain private.
 *
 * Example: "s3://your-bucket/showcase/my-clip.mp4"
 */
export const SHOWCASE_S3_URIS: string[] = [
  "s3://omenclip/2c6703ea-0acd-4bb0-9e9e-cc54fc671096/clip_1.mp4",
  "s3://omenclip/11751ddf-3e91-4673-9632-9b6d67b53200/clip_6.mp4",
  "s3://omenclip/11751ddf-3e91-4673-9632-9b6d67b53200/clip_4.mp4",
  "s3://omenclip/0de9e936-add7-452c-b595-f78d917bf537/clip_8.mp4",
  "s3://omenclip/0de9e936-add7-452c-b595-f78d917bf537/clip_6.mp4",
  "s3://omenclip/0de9e936-add7-452c-b595-f78d917bf537/clip_5.mp4",
  "s3://omenclip/2d7efc88-c143-482d-85e4-b22064d607c7/clip_2.mp4",
  "s3://omenclip/2d7efc88-c143-482d-85e4-b22064d607c7/clip_1.mp4",
  "s3://omenclip/2c6703ea-0acd-4bb0-9e9e-cc54fc671096/clip_3.mp4",
];

export const SHOWCASE_CLIPS: ShowcaseClip[] = SHOWCASE_S3_URIS.map(
  (src, index) => ({
    src,
    title: `Slayshot cut ${String(index + 1).padStart(2, "0")}`,
    category: "Made with Slayshot",
  }),
);
