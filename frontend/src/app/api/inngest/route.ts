import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { clipVideo, clipYouTubeVideoWorkflow, testStepFetch, retrieveTextFile } from "@/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    clipVideo,
    clipYouTubeVideoWorkflow,
    testStepFetch,
    retrieveTextFile,
  ],
});
