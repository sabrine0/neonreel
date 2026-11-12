// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { useMemo, useRef, useState } from "react";
import {
  ASPECTS,
  ASPECT_SIZE,
  CAMERAS,
  EDIT_IDEAS,
  EDIT_MODEL_ID,
  MODELS,
  PROMPT_IDEAS,
  STYLES,
  costOf,
  type Aspect,
  type Kind,
  type ModelDef,
} from "@/lib/catalog";
import type { Generation } from "@/lib/types";
import { Lightbox } from "./Lightbox";
import { MediaTile } from "./MediaTile";
import { MotionPlayer } from "./MotionPlayer";
import { Popover, PopoverOption } from "./Popover";
import { Button, EmptyState, Segmented } from "./ui";
import { useGenerations } from "./useGenerations";

type Availability = Record<ModelDef["provider"], boolean>;

interface Props {
  /** Which backends are usable right now. */
  available: Availability;
  /** Ids of local models whose files are not downloaded. */
  missing: string[];
  /** A local language model is available to rewrite prompts. */
  improveReady: boolean;
  initialKind: Kind;
  initialCamera: string;
}

const LOCKED_HINT: Record<ModelDef["provider"], string> = {
  mock: "",
  fal: "Add FAL_KEY to .env.local to enable.",
  ffmpeg: "FFmpeg is not installed.",
  comfy: "ComfyUI is not running. Start it and reload this page.",
};

/** Prefers a real model over the demo one when a backend is available. */
function defaultModel(kind: Kind, available: Availability, missing: string[]): string {
  const usable = MODELS.filter(
    (m) => m.kind === kind && !m.internal && available[m.provider] && !missing.includes(m.id),
  );
  return (usable.find((m) => m.provider !== "mock") ?? usable[0]).id;
}

const MAX_SIDE = 1280;

/** Downscales in the browser so uploads stay small. */
async function toDataUrl(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.88);
}

/** The supported aspect ratio closest to a picture's own shape. */
async function pictureAspect(file: Blob): Promise<Aspect> {
  const bitmap = await createImageBitmap(file);
  const shape = bitmap.width / bitmap.height;
  bitmap.close();
  return ASPECTS.reduce((best, aspect) => {
    const distance = (a: Aspect) => Math.abs(Math.log(ASPECT_SIZE[a][0] / ASPECT_SIZE[a][1] / shape));
    return distance(aspect) < distance(best) ? aspect : best;
  });
}

const COUNTS = [1, 2, 4];

export function Studio({ available, missing, improveReady, initialKind, initialCamera }: Props) {
  const { items, credits, loaded, error: loadError, reload, remove, toggleFavorite, applyTool } =
    useGenerations();
  const [openId, setOpenId] = useState<string | null>(null);

  const [kind, setKind] = useState<Kind>(initialKind);
  const [modelByKind, setModelByKind] = useState<Record<Kind, string>>({
    image: defaultModel("image", available, missing),
    video: defaultModel("video", available, missing),
  });
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [duration, setDuration] = useState(5);
  const [cameraId, setCameraId] = useState(initialCamera);
  const [refImage, setRefImage] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [styleId, setStyleId] = useState("none");
  const [improving, setImproving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const promptBox = useRef<HTMLTextAreaElement>(null);

  const models = useMemo(() => MODELS.filter((m) => m.kind === kind && !m.internal), [kind]);
  const model = models.find((m) => m.id === modelByKind[kind]) ?? models[0];
  const durations = model.durations ?? [5];
  const activeDuration = durations.includes(duration) ? duration : durations[0];
  /** This model starts from a picture: every video, and picture editing. */
  const wantsPicture = kind === "video" || Boolean(model.requiresImage);
  const editing = kind === "image" && Boolean(model.requiresImage);
  const results = kind === "image" ? count : 1;
  // An edit instruction describes a change, so a look is not added to it.
  const style = STYLES.find((s) => s.id === styleId && !editing) ?? STYLES[0];
  const cost = costOf(model, activeDuration) * results;

  const blocker = !prompt.trim() && !refImage
    ? "Write a prompt first."
    : model.requiresImage && !refImage
      ? `${model.name} needs a picture. Add one with the button on the left.`
      : credits !== null && credits < cost
        ? "Not enough credits."
        : null;

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      setRefImage(await toDataUrl(file));
      // An edit keeps the picture's own shape, so show the matching ratio.
      if (editing) setAspect(await pictureAspect(file));
      setError(null);
    } catch {
      setError("That file could not be read as an image.");
    }
  }

  async function generate() {
    setSubmitting(true);
    setError(null);
    try {
      // Several results are separate jobs with different random seeds.
      for (let i = 0; i < results; i++) {
        const res = await fetch("/api/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelId: model.id,
            prompt: style.prompt && prompt.trim() ? `${prompt.trim()}, ${style.prompt}` : prompt,
            aspect,
            duration: activeDuration,
            cameraId,
            refImage: wantsPicture ? refImage : null,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Server returned ${res.status}`);
        }
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  /** Rewrites the prompt into a more detailed one with the local language model. */
  async function improve() {
    setImproving(true);
    setError(null);
    try {
      const res = await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, mode: kind === "video" ? "video" : editing ? "edit" : "image" }),
      });
      const body = (await res.json().catch(() => null)) as { prompt?: string; error?: string } | null;
      if (!res.ok || !body?.prompt) throw new Error(body?.error ?? `Server returned ${res.status}`);
      setPrompt(body.prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not improve the prompt.");
    } finally {
      setImproving(false);
    }
  }

  /** Starts a new video, or an edit, from one of the pictures in the gallery. */
  async function startFromPicture(gen: Generation, mode: "video" | "edit") {
    if (!gen.outputUrl) return;
    if (mode === "edit" && (!available.comfy || missing.includes(EDIT_MODEL_ID))) {
      setError("The picture editing model is not installed.");
      return;
    }
    try {
      const picture = await (await fetch(gen.outputUrl)).blob();
      setRefImage(await toDataUrl(picture));
      setPrompt("");
      setError(null);
      if (mode === "video") {
        setKind("video");
      } else {
        setKind("image");
        setModelByKind((prev) => ({ ...prev, image: EDIT_MODEL_ID }));
        setAspect(await pictureAspect(picture));
      }
      promptBox.current?.focus();
    } catch {
      setError("That picture could not be loaded.");
    }
  }

  /** Loads a past result's prompt and settings back into the prompt bar. */
  function reuse(gen: Generation) {
    setKind(gen.kind);
    // A style was added to the end of the prompt; put it back in the Style picker.
    const used = STYLES.find((s) => s.prompt && gen.prompt.endsWith(`, ${s.prompt}`));
    setPrompt(used ? gen.prompt.slice(0, -used.prompt.length - 2) : gen.prompt);
    setStyleId(used?.id ?? "none");
    setAspect(gen.aspect);
    if (gen.kind === "video") {
      setDuration(gen.duration);
      setCameraId(gen.cameraId);
    }
    const reusable = MODELS.find((m) => m.id === gen.modelId && !m.internal);
    if (reusable) setModelByKind((prev) => ({ ...prev, [gen.kind]: reusable.id }));
    promptBox.current?.focus();
  }

  /** Fills the prompt bar with a random idea to start from. */
  function surprise() {
    const ideas = PROMPT_IDEAS[kind].filter((idea) => idea !== prompt);
    setPrompt(ideas[Math.floor(Math.random() * ideas.length)]);
    promptBox.current?.focus();
  }

  // Story scenes live in the Library; this page shows only what was made here.
  const shown = items.filter((gen) => gen.kind === kind && !gen.storyId);
  const camera = CAMERAS.find((c) => c.id === cameraId) ?? CAMERAS[0];

  return (
    <div className="pb-64">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight">Create</h1>
          <p className="mt-1 text-base text-muted">
            Describe what you want in the bar below. Your results fill this page.
          </p>
        </div>
        <Segmented
          label="What to create"
          value={kind}
          onChange={setKind}
          options={[
            { value: "image", label: "Images" },
            { value: "video", label: "Videos" },
          ]}
        />
      </header>

      {loadError && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {loadError}
        </p>
      )}
      {loaded && shown.length === 0 ? (
        <EmptyState title={kind === "image" ? "No images yet" : "No videos yet"}>
          Type a prompt in the bar below and press Create.
        </EmptyState>
      ) : (
        <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">
          {shown.map((gen) => (
            <MediaTile
              key={gen.id}
              gen={gen}
              onDelete={(id) => void remove(id)}
              onReuse={reuse}
              onAnimate={(picture) => void startFromPicture(picture, "video")}
              onEdit={(picture) => void startFromPicture(picture, "edit")}
              onFavorite={(id) => void toggleFavorite(id)}
              onOpen={setOpenId}
              onTool={(id, modelId) => void applyTool(id, modelId)}
            />
          ))}
        </div>
      )}

      {openId && (
        <Lightbox
          items={shown.filter((gen) => gen.status === "done" && gen.outputUrl && gen.outputType !== "motion")}
          openId={openId}
          onChange={setOpenId}
          onClose={() => setOpenId(null)}
        />
      )}

      {/* The prompt bar: docked to the bottom of the window, above the gallery. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-ink via-ink/95 to-transparent px-4 pb-4 pt-16 sm:pb-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!submitting && blocker === null) void generate();
          }}
          className="neon-edge pointer-events-auto mx-auto max-w-3xl rounded-2xl border p-3"
        >
          {editing && refImage && !prompt.trim() && (
            <div className="mb-3 flex flex-wrap gap-2" aria-label="Edit ideas">
              {EDIT_IDEAS.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  onClick={() => {
                    setPrompt(idea);
                    promptBox.current?.focus();
                  }}
                  className="rounded-full border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent hover:text-white"
                >
                  {idea}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-3">
            {wantsPicture && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    void onFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                {refImage ? (
                  <div className="relative size-16 shrink-0 overflow-hidden rounded-lg border border-line">
                    <img src={refImage} alt="Reference picture" className="size-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setRefImage(null)}
                      aria-label="Remove the reference picture"
                      className="absolute right-0.5 top-0.5 grid size-6 place-items-center rounded-md bg-black/80 text-sm hover:bg-black"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void onFile(e.dataTransfer.files[0]);
                    }}
                    title={`Add a picture to ${editing ? "edit" : "animate"}. Drop one here or click to choose.`}
                    className="grid size-16 shrink-0 place-items-center rounded-lg border border-dashed border-edge text-center text-xs leading-tight text-muted transition-colors hover:border-muted hover:bg-raised hover:text-white"
                  >
                    Add
                    <br />
                    picture
                  </button>
                )}
              </>
            )}
            <textarea
              ref={promptBox}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit();
              }}
              rows={2}
              maxLength={2000}
              aria-label="Prompt"
              placeholder={
                editing
                  ? "Describe the change: make it night, add falling snow, keep everything else"
                  : kind === "image"
                    ? "Describe the image: a lighthouse on a basalt cliff at dusk, long exposure"
                    : "Describe the motion: waves crash against the rocks as fog rolls in"
              }
              className="min-h-16 w-full resize-none bg-transparent px-1 py-1 text-base leading-relaxed text-white outline-none placeholder:text-faint"
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Popover label="Model" value={model.name.replace(" (local GPU)", "")} width="w-80">
              {(close) =>
                models.map((m) => {
                  const filesMissing = missing.includes(m.id);
                  const locked = !available[m.provider] || filesMissing;
                  return (
                    <PopoverOption
                      key={m.id}
                      selected={m.id === model.id}
                      disabled={locked}
                      onSelect={() => {
                        setModelByKind((prev) => ({ ...prev, [kind]: m.id }));
                        close();
                      }}
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="font-medium">{m.name}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted">
                          {m.cost === 0
                            ? "Free"
                            : `${m.cost} ${m.cost === 1 ? "credit" : "credits"}${m.kind === "video" ? " per second" : ""}`}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                        {!locked
                          ? m.blurb
                          : filesMissing
                            ? "Model files are not downloaded yet."
                            : LOCKED_HINT[m.provider]}
                      </span>
                    </PopoverOption>
                  );
                })
              }
            </Popover>

            {kind === "image" && (
              <Popover
                label="Number of results"
                value={count === 1 ? "1 result" : `${count} results`}
                width="w-40"
              >
                {(close) =>
                  COUNTS.map((n) => (
                    <PopoverOption
                      key={n}
                      selected={n === count}
                      onSelect={() => {
                        setCount(n);
                        close();
                      }}
                    >
                      {n === 1 ? "1 result" : `${n} results`}
                    </PopoverOption>
                  ))
                }
              </Popover>
            )}

            {!editing && (
              <Popover label="Style" value={style.id === "none" ? "Style" : style.name} width="w-72">
                {(close) =>
                  STYLES.map((s) => (
                    <PopoverOption
                      key={s.id}
                      selected={s.id === style.id}
                      onSelect={() => {
                        setStyleId(s.id);
                        close();
                      }}
                    >
                      <span className="font-medium">{s.name}</span>
                      {s.prompt && (
                        <span className="mt-0.5 block truncate text-xs text-muted">{s.prompt}</span>
                      )}
                    </PopoverOption>
                  ))
                }
              </Popover>
            )}

            <Popover label="Aspect ratio" value={aspect} width="w-36">
              {(close) =>
                ASPECTS.map((a) => (
                  <PopoverOption
                    key={a}
                    selected={a === aspect}
                    onSelect={() => {
                      setAspect(a);
                      close();
                    }}
                  >
                    {a}
                  </PopoverOption>
                ))
              }
            </Popover>

            {kind === "video" && (
              <>
                <Popover label="Length" value={`${activeDuration} seconds`} width="w-40">
                  {(close) =>
                    durations.map((d) => (
                      <PopoverOption
                        key={d}
                        selected={d === activeDuration}
                        onSelect={() => {
                          setDuration(d);
                          close();
                        }}
                      >
                        {d} seconds
                      </PopoverOption>
                    ))
                  }
                </Popover>

                <Popover label="Camera move" value={camera.name} width="w-[26rem] max-w-[calc(100vw-3rem)]">
                  {(close) => (
                    <div className="grid grid-cols-3 gap-2">
                      {CAMERAS.map((cam) => (
                        <button
                          key={cam.id}
                          type="button"
                          title={cam.description}
                          aria-pressed={cameraId === cam.id}
                          onClick={() => {
                            setCameraId(cam.id);
                            close();
                          }}
                          className={`overflow-hidden rounded-lg border text-left transition-all duration-150 hover:-translate-y-0.5 ${
                            cameraId === cam.id ? "border-accent bg-accent/10" : "border-line hover:border-muted"
                          }`}
                        >
                          <MotionPlayer cameraId={cam.id} src={refImage ?? undefined} duration={3} />
                          <span className="block truncate px-2 py-1.5 text-xs">{cam.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </Popover>
              </>
            )}

            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-xs text-muted sm:inline">
                {error ? (
                  <span role="alert" className="text-danger">
                    {error}
                  </span>
                ) : (
                  (blocker ?? (cost === 0 ? "Free" : `${cost} of ${credits ?? "…"} credits`))
                )}
              </span>
              {!prompt.trim() && !editing ? (
                <Button variant="ghost" size="sm" onClick={surprise} title="Fill in a random idea to start from">
                  Surprise me
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!improveReady || improving || !prompt.trim()}
                  onClick={() => void improve()}
                  title={
                    improveReady
                      ? "Rewrite the prompt with more detail"
                      : "Needs Ollama running to rewrite prompts"
                  }
                >
                  {improving ? "Improving…" : "Improve prompt"}
                </Button>
              )}
              <Button type="submit" variant="primary" disabled={submitting || blocker !== null}>
                {submitting ? "Starting…" : "Create"}
              </Button>
            </div>
          </div>
          {(error || blocker) && (
            <p className={`mt-2 text-xs sm:hidden ${error ? "text-danger" : "text-muted"}`}>{error ?? blocker}</p>
          )}
        </form>
      </div>
    </div>
  );
}
