import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Captions,
  Check,
  Github,
  ScanFace,
  Scissors,
  Sparkles,
} from "lucide-react";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import ClipShowcase from "@/components/landing/ClipShowcase";
import {
  SHOWCASE_CLIPS,
  type ShowcaseClip,
} from "@/lib/showcase-clips";

export const dynamic = "force-dynamic";

const GITHUB_URL = "https://github.com/anonthedev/slayshot";

async function resolveShowcaseClips(): Promise<ShowcaseClip[]> {
  if (SHOWCASE_CLIPS.length === 0) return [];

  const client = new S3Client({ region: process.env.AWS_REGION });

  const clips = await Promise.all(
    SHOWCASE_CLIPS.map(async (clip) => {
      const match = clip.src.match(/^s3:\/\/([^/]+)\/(.+)$/);
      if (!match) {
        console.error(`Invalid S3 showcase URI: ${clip.src}`);
        return null;
      }

      try {
        const [, Bucket, Key] = match;
        const src = await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket, Key }),
          { expiresIn: 60 * 60 },
        );
        return { ...clip, src };
      } catch (error) {
        console.error(`Could not load showcase clip: ${clip.title}`, error);
        return null;
      }
    }),
  );

  return clips.filter((clip): clip is ShowcaseClip => clip !== null);
}

export default async function Home() {
  const clips = await resolveShowcaseClips();

  return (
    <main className="landing-page min-h-screen overflow-hidden bg-[#080808] text-[#f4f4ef]">
      <div className="landing-noise" aria-hidden="true" />

      <nav className="relative z-50 mx-auto flex w-full max-w-[1400px] items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c7ff35]"
          aria-label="Slayshot home"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-[#c7ff35] text-black">
            <Scissors className="size-4 -rotate-12" />
          </span>
          <span className="text-lg font-bold tracking-[-0.04em]">slayshot</span>
        </Link>

        <div className="hidden items-center gap-8 text-sm text-white/60 md:flex">
          <a className="transition hover:text-white" href="#showcase">
            Showcase
          </a>
          <a className="transition hover:text-white" href="#how-it-works">
            How it works
          </a>
          <a
            className="inline-flex items-center gap-2 transition hover:text-white"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
          >
            GitHub
            <ArrowUpRight className="size-3.5" />
          </a>
        </div>

        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 text-sm font-medium transition hover:border-white/30 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c7ff35]"
        >
          <Github className="size-4" />
          <span className="hidden sm:inline">View source</span>
          <ArrowUpRight className="size-3.5" />
        </a>
      </nav>

      <section className="relative mx-auto max-w-[1400px] px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:px-12 lg:pb-28 lg:pt-28">
        <div className="landing-orb" aria-hidden="true" />
        <div className="relative z-10 max-w-6xl">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="mb-8 inline-flex items-center gap-3 rounded-full border border-[#c7ff35]/25 bg-[#c7ff35]/[0.07] py-1.5 pl-2 pr-4 text-xs font-semibold uppercase tracking-[0.12em] text-[#dcff83] transition hover:border-[#c7ff35]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c7ff35]"
          >
            <span className="rounded-full bg-[#c7ff35] px-2 py-1 text-[9px] font-black text-black">
              Final update
            </span>
            Slayshot has shut down
            <ArrowRight className="size-3.5" />
          </a>

          <h1 className="max-w-[1100px] text-[clamp(3.6rem,10vw,9.2rem)] font-semibold leading-[0.84] tracking-[-0.075em] text-white">
            Slayshot shut down.
            <span className="block text-white/30">The work lives on.</span>
          </h1>

          <div className="mt-10 grid items-end gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
            <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-white/35">
              <span className="h-px w-12 bg-[#c7ff35]" />
              Proof of what we built
            </div>

            <div>
              <p className="max-w-xl text-lg leading-relaxed text-white/60 sm:text-xl">
                Slayshot is no longer running. Before it went offline, it turned
                long videos into sharp, captioned clips ready to post. Here is
                some of the work it made.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-13 items-center justify-center gap-2.5 rounded-full bg-[#c7ff35] px-6 text-sm font-bold text-black transition hover:scale-[1.02] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <Github className="size-4" />
                  Explore the code
                  <ArrowUpRight className="size-4" />
                </a>
                <a
                  href="#showcase"
                  className="inline-flex h-13 items-center justify-center gap-2 rounded-full border border-white/15 px-6 text-sm font-semibold text-white transition hover:border-white/30 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c7ff35]"
                >
                  See the proof
                  <ArrowRight className="size-4" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="showcase"
        className="relative border-y border-white/10 bg-[#0c0c0c] py-20 sm:py-28"
      >
        <div className="mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-12">
          <div className="mb-10 flex flex-col justify-between gap-6 sm:mb-14 sm:flex-row sm:items-end">
            <div>
              <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-[#c7ff35]">
                Proof of work
              </p>
              <h2 className="max-w-3xl text-4xl font-semibold leading-[0.95] tracking-[-0.05em] text-white sm:text-6xl lg:text-7xl">
                What Slayshot made.
                <br />
                <span className="text-white/30">Before the shutdown.</span>
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-white/45 sm:text-right">
              Hooks found, faces tracked, captions timed, and layouts reframed
              for a screen held in one hand.
            </p>
          </div>

          <ClipShowcase clips={clips} />
        </div>
      </section>

      <section
        id="how-it-works"
        className="mx-auto max-w-[1400px] px-5 py-24 sm:px-8 sm:py-32 lg:px-12"
      >
        <div className="grid gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24">
          <div className="lg:sticky lg:top-12 lg:self-start">
            <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-[#c7ff35]">
              How it worked
            </p>
            <h2 className="text-4xl font-semibold leading-[0.95] tracking-[-0.05em] text-white sm:text-6xl">
              One complete
              <br />
              clip pipeline.
              <br />
              <span className="text-white/30">Now open to inspect.</span>
            </h2>
            <p className="mt-7 max-w-md leading-relaxed text-white/50">
              The hosted product is gone, but the pipeline is still here.
              Trace every step, swap any model, and deploy it wherever you
              want.
            </p>
          </div>

          <div className="border-t border-white/15">
            {[
              {
                number: "01",
                icon: Sparkles,
                title: "Find the signal",
                copy: "Transcription and scoring surface the moments with enough context to stand on their own.",
              },
              {
                number: "02",
                icon: Scissors,
                title: "Shape the cut",
                copy: "Turn the strongest sections into tight clips without dragging a timeline frame by frame.",
              },
              {
                number: "03",
                icon: ScanFace,
                title: "Keep people in frame",
                copy: "Active-speaker detection reframes wide video into a vertical composition that follows the conversation.",
              },
              {
                number: "04",
                icon: Captions,
                title: "Ship it captioned",
                copy: "Word-timed subtitles make every clip understandable with the sound off and ready for the feed.",
              },
            ].map((step) => (
              <article
                key={step.number}
                className="group grid gap-5 border-b border-white/15 py-8 transition sm:grid-cols-[3rem_3.5rem_1fr] sm:items-start sm:gap-6 sm:py-10"
              >
                <span className="font-mono text-xs text-white/25">
                  {step.number}
                </span>
                <span className="grid size-12 place-items-center rounded-xl border border-white/10 bg-white/[0.03] text-white/55 transition group-hover:border-[#c7ff35]/40 group-hover:text-[#c7ff35]">
                  <step.icon className="size-5" />
                </span>
                <div>
                  <h3 className="text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
                    {step.title}
                  </h3>
                  <p className="mt-3 max-w-xl leading-relaxed text-white/45">
                    {step.copy}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-5 pb-8 sm:px-8 lg:px-12">
        <div className="landing-cta relative overflow-hidden rounded-[2rem] bg-[#c7ff35] px-6 py-16 text-black sm:px-12 sm:py-20 lg:px-20 lg:py-24">
          <div className="relative z-10 grid gap-12 lg:grid-cols-[1.3fr_0.7fr] lg:items-end">
            <div>
              <p className="mb-5 text-xs font-black uppercase tracking-[0.2em]">
                The product is gone. The source is not.
              </p>
              <h2 className="max-w-4xl text-5xl font-semibold leading-[0.88] tracking-[-0.065em] sm:text-7xl lg:text-8xl">
                Take what worked.
                <br />
                Build what is next.
              </h2>
            </div>
            <div>
              <ul className="mb-8 space-y-3 text-sm font-semibold">
                {[
                  "Study the complete pipeline",
                  "Run it on your infrastructure",
                  "Fork it and take it further",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <span className="grid size-5 place-items-center rounded-full bg-black text-[#c7ff35]">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-black px-7 text-sm font-bold text-white transition hover:scale-[1.02] hover:bg-[#181818] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-[#c7ff35] sm:w-auto"
              >
                <Github className="size-4" />
                Get the source
                <ArrowUpRight className="size-4" />
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-[1400px] flex-col gap-6 px-5 py-10 text-sm text-white/35 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
        <div className="flex items-center gap-2 font-semibold text-white/70">
          <Scissors className="size-4 -rotate-12 text-[#c7ff35]" />
          slayshot
        </div>
        <p>Slayshot is gone. Its work is still here.</p>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 transition hover:text-white"
        >
          GitHub <ArrowUpRight className="size-3.5" />
        </a>
      </footer>
    </main>
  );
}
