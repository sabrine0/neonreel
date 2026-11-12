// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MotionPlayer } from "@/components/MotionPlayer";
import { Reveal } from "@/components/Reveal";
import { CAMERAS } from "@/lib/catalog";
import type { Generation, GenerationList } from "@/lib/types";

/** Artwork in /public/art was made with this app's own models. */
const TOOLS = [
  {
    href: "/story",
    title: "Story",
    text: "A narrated video of up to 20 scenes",
    art: "/art/story.jpg",
    wide: true,
  },
  { href: "/create?kind=image", title: "Images", text: "One picture from a prompt", art: "/art/image.jpg" },
  { href: "/create?kind=video", title: "Videos", text: "Animate a picture into a clip", art: "/art/video.jpg" },
  { href: "/presets", title: "Camera presets", text: "12 named camera moves", art: "/art/presets.jpg" },
  { href: "/library", title: "Library", text: "Everything you have made", art: "/art/library.jpg" },
];

const STEPS = [
  {
    title: "Write the scenes",
    text: "Type an idea and let the app write the scenes, or paste your own script with dialogue.",
  },
  {
    title: "Pick a look and a voice",
    text: "Describe the main character once and it stays the same in every scene.",
  },
  {
    title: "Get one video",
    text: "Each scene is drawn, animated, voiced and joined into a single file you can download.",
  },
];

const FEATURED = ["dolly-in", "orbit", "crane-up", "crash-zoom"];
const RECENT_COUNT = 8;

/** The newest finished pictures and clips; empty until loaded or when the request fails. */
function useRecent(): Generation[] {
  const [recent, setRecent] = useState<Generation[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/generations", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<GenerationList>) : null))
      .catch(() => null)
      .then((body) => {
        if (cancelled || !Array.isArray(body?.generations)) return;
        setRecent(
          [...body.generations]
            .sort((a, b) => b.createdAt - a.createdAt)
            .filter((g) => g.status === "done" && g.outputUrl && g.outputType !== "motion")
            .slice(0, RECENT_COUNT),
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return recent;
}

export function HomePage() {
  const recent = useRecent();

  return (
    <div className="space-y-20">
      {/* Hero: one large picture with the pitch over it. */}
      <section className="animate-rise relative isolate overflow-hidden rounded-2xl border border-line">
        <MotionPlayer cameraId="dolly-in" src="/art/story.jpg" aspect="16:9" duration={14} className="max-h-[34rem] w-full" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink via-ink/60 to-transparent" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-ink/80 via-transparent to-transparent" />
        <div className="stagger absolute inset-x-0 bottom-0 max-w-2xl p-6 sm:p-10">
          <h1 className="text-3xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Turn an idea into a <span className="neon-text">narrated video</span>, on your own
            computer
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-white/80">
            Neonreel writes the scenes, draws them, animates them and adds the voices. Free, and
            nothing is uploaded.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/story"
              className="neon-fill inline-flex h-11 items-center rounded-lg px-6 text-sm font-semibold active:scale-[0.97]"
            >
              Make a story video
            </Link>
            <Link
              to="/create"
              className="inline-flex h-11 items-center rounded-lg border border-white/40 bg-black/30 px-6 text-sm backdrop-blur transition-all duration-150 hover:border-white hover:bg-black/50 active:scale-[0.97]"
            >
              Create one image or clip
            </Link>
          </div>
        </div>
      </section>

      {/* Tools as picture tiles. */}
      <section aria-labelledby="tools">
        <h2 id="tools" className="text-xl font-semibold tracking-tight">
          What do you want to make?
        </h2>
        <div className="stagger mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              to={tool.href}
              className={`lift group relative isolate overflow-hidden rounded-xl border border-line hover:border-accent ${
                tool.wide ? "sm:col-span-2 lg:row-span-2" : ""
              }`}
            >
              <img
                src={tool.art}
                alt=""
                className={`w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105 ${
                  tool.wide ? "h-full min-h-56" : "aspect-[16/10]"
                }`}
              />
              <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
                <h3 className={`flex items-center justify-between font-semibold ${tool.wide ? "text-2xl" : "text-lg"}`}>
                  {tool.title}
                  <span
                    aria-hidden
                    className="text-base text-white/70 transition-all duration-200 group-hover:translate-x-1 group-hover:text-accent"
                  >
                    →
                  </span>
                </h3>
                <p className="mt-0.5 text-sm text-white/75">{tool.text}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {recent.length > 0 && (
        <Reveal>
          <section aria-labelledby="recent">
            <div className="flex items-end justify-between gap-4">
              <h2 id="recent" className="text-xl font-semibold tracking-tight">
                Your recent work
              </h2>
              <Link to="/library" className="text-sm text-muted transition-colors hover:text-white">
                Open the library
              </Link>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {recent.map((gen) => (
                <Link
                  key={gen.id}
                  to="/library"
                  title={gen.prompt}
                  className="lift group relative overflow-hidden rounded-xl border border-line bg-panel hover:border-accent"
                >
                  {gen.outputType === "video" ? (
                    <video
                      src={gen.outputUrl}
                      muted
                      loop
                      autoPlay
                      playsInline
                      preload="metadata"
                      className="aspect-video w-full bg-black object-cover"
                    />
                  ) : (
                    <img
                      src={gen.outputUrl}
                      alt={gen.prompt}
                      loading="lazy"
                      className="aspect-video w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                    />
                  )}
                  {gen.kind === "video" && (
                    <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-1 text-xs font-medium backdrop-blur">
                      Video
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        </Reveal>
      )}

      <Reveal>
        <section aria-labelledby="camera">
          <div className="flex items-end justify-between gap-4">
            <h2 id="camera" className="text-xl font-semibold tracking-tight">
              Camera moves
            </h2>
            <Link to="/presets" className="text-sm text-muted transition-colors hover:text-white">
              See all {CAMERAS.length}
            </Link>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CAMERAS.filter((c) => FEATURED.includes(c.id)).map((cam) => (
              <Link
                key={cam.id}
                to={`/create?kind=video&camera=${cam.id}`}
                className="lift overflow-hidden rounded-xl border border-line bg-panel hover:border-accent"
              >
                <MotionPlayer cameraId={cam.id} duration={3.5} />
                <p className="p-4 font-medium">{cam.name}</p>
              </Link>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section aria-labelledby="how">
          <h2 id="how" className="text-xl font-semibold tracking-tight">
            How a story is made
          </h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="rounded-xl border border-line bg-panel p-6 transition-colors duration-200 hover:border-edge"
              >
                <span
                  aria-hidden
                  className="neon-fill grid size-8 place-items-center rounded-lg text-sm font-semibold"
                >
                  {i + 1}
                </span>
                <h3 className="mt-4 text-base font-medium">{step.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </Reveal>
    </div>
  );
}
