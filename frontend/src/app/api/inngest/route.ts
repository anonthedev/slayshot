import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { clipVideo, testStepFetch } from "@/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    clipVideo,
    testStepFetch,
  ],
});
