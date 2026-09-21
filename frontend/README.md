# Slayshot frontend

This directory contains the Next.js web application, Auth.js integration,
Inngest workflow, and landing page for the archived Slayshot project.

See the [root README](../README.md) for architecture, database setup, service
configuration, and backend deployment.

## Local development

```bash
cp .env.example .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

The landing page is implemented in `src/app/page.tsx`. Showcase S3 objects are
configured through `SHOWCASE_S3_URIS`; no object paths are stored in source.
