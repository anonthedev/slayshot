import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { clipVideo, clipYouTubeVideoWorkflow, testStepFetch } from "@/inngest/functions";

// Create an API that serves zero functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    clipVideo,
    clipYouTubeVideoWorkflow,
    testStepFetch,
  ],
});
