# Slayshot

Slayshot turned long-form video into vertical, captioned clips by combining
transcription, moment scoring, active-speaker detection, reframing, and
subtitle rendering.

The hosted Slayshot product has shut down. This repository is an open-source
archive of the pipeline and web application, provided as-is for people who
want to study it, run it themselves, or build on the work.

The repository keeps its historical `omenclip` name; the product and default
deployment resources use the Slayshot name.

## What is included

- A Next.js web app for authentication, YouTube imports, billing, and clip
  playback.
- An Inngest workflow that coordinates processing and updates job state.
- A GPU-backed Modal service for transcription and video processing.
- WhisperX transcription and alignment.
- Gemini-based moment selection.
- LR-ASD active-speaker detection and vertical reframing.
- S3-backed source videos, generated clips, metadata, and showcase media.

## Architecture

```text
Browser
  │
  ▼
Next.js ── Auth.js / Google OAuth
  │  ├── Supabase (users, jobs, clips, credits)
  │  ├── S3 (source videos, outputs, showcase)
  │  ├── Polar (credit purchases)
  │  └── Inngest
  │        │
  │        ▼
  └──── Modal GPU service
           ├── yt-dlp / FFmpeg
           ├── WhisperX
           ├── Gemini
           └── LR-ASD
```

## Prerequisites

- Node.js 20+ and pnpm
- Python 3.12
- Git with submodule support
- A Supabase project
- An S3 bucket and AWS credentials
- A Modal account with GPU access
- Google OAuth and Gemini API credentials
- Inngest for background workflows
- A YouTube Data API key
- Polar credentials if you want to keep purchases enabled

## Clone

The LR-ASD dependency is a Git submodule, so clone recursively:

```bash
git clone --recurse-submodules https://github.com/anonthedev/omenclip.git
cd omenclip
```

For an existing clone:

```bash
git submodule update --init --recursive
```

## Database setup

The `supabase/` directory includes the local configuration and two ordered
migrations:

- `base_schema` creates the Auth.js adapter schema, application tables,
  profile synchronization, grants, indexes, and row-level security.
- `harden_credit_payments` adds atomic purchases, processing reservations,
  refunds, and protected credit columns.

Auth.js stores its adapter tables in the `next_auth` schema. Add `next_auth`
to the exposed schemas in **Supabase → Project Settings → API**, alongside
`public` and `graphql_public`.

The application uses Auth.js adapter tables plus the following public tables:

- `users` for credit balances and Polar customer data
- `uploaded_files` for source videos and processing state
- `clips` for generated S3 objects and clip metadata
- `credit_purchases` for Polar purchase history

Use the project JWT secret for `SUPABASE_JWT_SECRET`; the app signs a short
Supabase access token for each Auth.js session.

Install the Supabase CLI, then link and apply the migrations:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

For an existing database, review duplicate non-null `polar_checkout_id`
values before applying the unique payment index.

## Frontend setup

```bash
cd frontend
pnpm install
cp .env.example .env.local
pnpm dev
```

Run the local Inngest worker in a second terminal:

```bash
cd frontend
pnpm inngest-dev
```

Fill every variable needed by the features you enable. The complete list and
examples are in `frontend/.env.example`.

Set `APP_URL` to the public origin Polar and Inngest should call. Use
`http://localhost:3000` locally and the HTTPS origin in production, not
localhost. Set `POLAR_SERVER=sandbox` while testing and change it to
`production` only when using a live Polar token and live product IDs.

Configure Google OAuth with this local callback URL:

```text
http://localhost:3000/api/auth/callback/google
```

The frontend AWS principal needs permission to get and list generated clips
and delete temporary metadata. The Modal principal needs permission to put and
get source videos, outputs, metadata, and split-layout assets.

### Landing-page showcase

Showcase media is configured with the server-only `SHOWCASE_S3_URIS`
environment variable. Use either a JSON array:

```dotenv
SHOWCASE_S3_URIS=["s3://your-bucket/showcase/clip-1.mp4","s3://your-bucket/showcase/clip-2.mp4"]
```

or a comma-separated list. The page creates short-lived signed URLs on the
server. An empty value hides the clips without breaking the page.

## Backend setup

The backend is deployed as a Modal app. From `backend/`:

```bash
python -m venv .venv
source .venv/bin/activate
pip install modal
modal setup
```

Choose resource names in your shell:

```bash
export MODAL_APP_NAME=slayshot
export MODAL_SECRET_NAME=slayshot-secret
export MODAL_VOLUME_NAME=slayshot-model-cache
```

Create the runtime secret using the values described in
`backend/.env.example`:

```bash
modal secret create slayshot-secret \
  AUTH_TOKEN=replace-with-a-long-random-value \
  GEMINI_API_KEY=your-gemini-key \
  AWS_ACCESS_KEY_ID=your-access-key \
  AWS_SECRET_ACCESS_KEY=your-secret-key \
  AWS_DEFAULT_REGION=us-east-1 \
  S3_BUCKET_NAME=your-bucket
```

Then deploy:

```bash
modal deploy main.py
```

Set the resulting `process_video` web endpoint as `CLIPPER_ENDPOINT` in the
frontend, and set `MODAL_AUTH_TOKEN` to the same value as `AUTH_TOKEN`.

`cookies.txt` is optional and ignored by Git. Place a Netscape-format cookie
file at `backend/cookies.txt` if yt-dlp needs authenticated YouTube access.

The Modal image applies a small NumPy compatibility patch to LR-ASD during
build (`np.int` → `int`). This keeps the upstream submodule unchanged.

For split layouts, upload the configured bait videos to:

```text
s3://your-bucket/gameplay/minecraft_night.mp4
s3://your-bucket/gameplay/subway_surfer.mp4
```

Change `GAMEPLAY_S3_PREFIX` if you use a prefix other than `gameplay`.

## External-service configuration

- **Inngest:** point the app at `/api/inngest` and configure its event and
  signing keys.
- **Polar:** create two one-time products, set `POLAR_SERVER` to `sandbox`
  or `production`, set the product IDs in the frontend environment, and
  send signed `order.paid` webhooks to `/api/webhooks/polar`. Polar replaces
  `{CHECKOUT_ID}` in the checkout success URL.
- **YouTube:** enable YouTube Data API v3 for metadata lookup.
- **S3:** keep objects private; the app uses server-side access and presigned
  playback URLs.

If you do not need billing, remove or disable the pricing and Polar routes
rather than exposing them with placeholder credentials.

## Repository layout

```text
backend/                  Modal GPU service and processing pipeline
backend/patches/          Reproducible third-party compatibility patches
frontend/                 Next.js application and Inngest workflow
supabase/                 Local config and ordered database migrations
LICENSE                   Project license
THIRD_PARTY_NOTICES.md    Dependency attribution and notices
```

## Security and media rights

- Never commit `.env`, `cookies.txt`, AWS credentials, Supabase service keys,
  OAuth secrets, or exported user media.
- Use a dedicated S3 principal with access limited to one bucket.
- Rotate any credential that has previously been committed or shared.
- Only process and publish media you have permission to use.
- Signed showcase URLs temporarily grant access to the configured objects to
  anyone who loads the landing page.

## Third-party software

LR-ASD remains under its upstream MIT license and retains its original
copyright and academic citations. See `THIRD_PARTY_NOTICES.md` and
`backend/asd/README.md`.

## License

Slayshot is released under the MIT License. See `LICENSE`.
