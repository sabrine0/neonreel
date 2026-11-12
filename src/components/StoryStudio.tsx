"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ASPECTS,
  CAMERAS,
  VOICES,
  getCamera,
  narrationWords,
  spokenWords,
  type Aspect,
} from "@/lib/catalog";
import { EXAMPLES } from "@/lib/examples";
import { parseScript } from "@/lib/script";
import type { SceneView, StoryView } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  ConfirmDelete,
  EmptyState,
  Field,
  Group,
  Input,
  ProgressBar,
  SectionTitle,
  Segmented,
  Select,
  Textarea,
} from "./ui";

interface Props {
  /** A real image and video backend are both available. */
  ready: boolean;
  /** A local language model can write the scene list. */
  plannerReady: boolean;
  /** The local text-to-speech engine is installed. */
  voiceReady: boolean;
  /** The image-editing model for consistent characters is installed. */
  characterReady: boolean;
  imageModelName?: string;
  /** Usable video models, fastest first. `speed` = render seconds per video second. */
  videoModels: { id: string; name: string; durations: number[]; speed: number }[];
}

const MIN_SCENES = 2;
const MAX_SCENES = 20;
const POLL_MS = 3000;

interface SceneDraft {
  prompt: string;
  narration: string;
  /** The main character appears in this scene. */
  withCharacter: boolean;
}

const EMPTY_SCENE: SceneDraft = { prompt: "", narration: "", withCharacter: true };

function formatMinutes(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "about 1 minute" : `about ${minutes} minutes`;
}

function useStories() {
  const [stories, setStories] = useState<StoryView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    let again = true;
    try {
      const res = await fetch("/api/stories", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { stories: StoryView[] };
        setStories(data.stories);
        again = data.stories.some((s) => s.status === "running" || s.status === "joining");
      }
    } catch {
      // Network blip: keep polling.
    } finally {
      setLoaded(true);
    }
    if (again) timer.current = setTimeout(reload, POLL_MS);
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reload]);

  const remove = useCallback(
    async (id: string) => {
      setStories((prev) => prev.filter((s) => s.id !== id));
      await fetch(`/api/stories/${id}`, { method: "DELETE" });
      void reload();
    },
    [reload],
  );

  const resume = useCallback(
    async (id: string) => {
      await fetch(`/api/stories/${id}`, { method: "POST" });
      void reload();
    },
    [reload],
  );

  const redo = useCallback(
    async (id: string, scene: number) => {
      await fetch(`/api/stories/${id}/scenes/${scene}`, { method: "POST" });
      void reload();
    },
    [reload],
  );

  return { stories, loaded, reload, remove, resume, redo };
}

export function StoryStudio({
  ready,
  plannerReady,
  voiceReady,
  characterReady,
  imageModelName,
  videoModels,
}: Props) {
  const { stories, loaded, reload, remove, resume, redo } = useStories();

  const [idea, setIdea] = useState("");
  const [count, setCount] = useState(4);
  const [title, setTitle] = useState("");
  const [style, setStyle] = useState("");
  const [scenes, setScenes] = useState<SceneDraft[]>([EMPTY_SCENE, EMPTY_SCENE, EMPTY_SCENE]);
  const [voiceId, setVoiceId] = useState(voiceReady ? VOICES[0].id : "");
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [videoModelId, setVideoModelId] = useState(videoModels[0]?.id ?? "");
  const videoModel = videoModels.find((m) => m.id === videoModelId) ?? videoModels[0];
  const durations = videoModel?.durations ?? [5];
  const [pickedDuration, setDuration] = useState(durations[0]);
  const duration = durations.includes(pickedDuration) ? pickedDuration : durations[0];
  const [character, setCharacter] = useState("");
  const [consistent, setConsistent] = useState(characterReady);
  const [characterPhoto, setCharacterPhoto] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const useCharacter =
    consistent && characterReady && (character.trim().length > 0 || characterPhoto !== null);
  const [cameraId, setCameraId] = useState("auto");
  const [subtitles, setSubtitles] = useState(false);
  const [fade, setFade] = useState(false);
  const [music, setMusic] = useState<{ name: string; data: string } | null>(null);
  const musicInput = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState("");
  const [planning, setPlanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"scenes" | "stories">("scenes");
  const openedStories = useRef(false);

  // On first load, show a story that is still rendering instead of the editor.
  useEffect(() => {
    if (!loaded || openedStories.current) return;
    openedStories.current = true;
    if (stories.some((s) => s.status === "running" || s.status === "joining")) setTab("stories");
  }, [loaded, stories]);

  const filled = scenes.filter((s) => s.prompt.trim());
  const wordBudget = narrationWords(duration);
  // Stills take about 25s each (45s when redrawn from the character reference).
  const estimate =
    filled.length * ((useCharacter ? 45 : 25) + duration * (videoModel?.speed ?? 100)) +
    (useCharacter ? 30 : 0);
  const blocker = !ready
    ? "Story mode needs a real image and video model. Start ComfyUI, then reload this page."
    : filled.length < MIN_SCENES
      ? `Write at least ${MIN_SCENES} scenes.`
      : null;

  function setScene(index: number, patch: Partial<SceneDraft>) {
    setScenes((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  /** Fills the form from a script (see src/lib/script.ts for the format). */
  function loadScript(text: string = pasted) {
    const script = parseScript(text);
    if (script.scenes.length < MIN_SCENES) {
      setError(`The script needs at least ${MIN_SCENES} scene lines.`);
      return;
    }
    setError(null);
    setTab("scenes");
    setScenes(script.scenes.slice(0, MAX_SCENES));
    setTitle(script.title);
    setStyle(script.style);
    setCharacter(script.character);
    setPasted("");
  }

  /** Loads a story's scenes and settings back into the editor, to change and remake it. */
  function loadStory(story: StoryView) {
    setTitle(story.title);
    setStyle(story.style);
    setCharacter(story.character ?? "");
    setConsistent(Boolean(story.character) && characterReady);
    setScenes(
      story.scenes.map((scene) => ({
        prompt: scene.prompt,
        narration: scene.narration ?? "",
        withCharacter: scene.withCharacter,
      })),
    );
    setVoiceId(story.voiceId && voiceReady ? story.voiceId : "");
    setSubtitles(story.subtitled);
    setAspect(story.aspect);
    setDuration(story.duration);
    if (videoModels.some((m) => m.id === story.videoModelId)) setVideoModelId(story.videoModelId);
    setError(null);
    setTab("scenes");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Shrinks the chosen picture in the browser and keeps it as the character reference. */
  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      setCharacterPhoto(canvas.toDataURL("image/jpeg", 0.9));
      setConsistent(true);
      setError(null);
    } catch {
      setError("That file could not be read as a picture.");
    }
  }

  /** Reads the chosen music file into memory so it can be sent with the story. */
  function chooseMusic(file: File | undefined) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError("The music file is larger than 20 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setMusic({ name: file.name, data: String(reader.result) });
      setError(null);
    };
    reader.onerror = () => setError("That music file could not be read.");
    reader.readAsDataURL(file);
  }

  async function plan() {
    // A finished script pasted into the idea box is loaded as it is. Sending it
    // to the scene writer would rewrite it and lose scenes.
    if (/\|\|/.test(idea) || /^\s*(title|character|style)\s*:/im.test(idea)) {
      loadScript(idea);
      return;
    }
    setPlanning(true);
    setError(null);
    try {
      const res = await fetch("/api/stories/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, count, duration, voiceId }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        title?: string;
        style?: string;
        character?: string;
        scenes?: string[];
        narrations?: string[];
        characterScenes?: boolean[];
      } | null;
      if (!res.ok || !body?.scenes) throw new Error(body?.error ?? `Server returned ${res.status}`);
      const narrations = body.narrations ?? [];
      const shown = body.characterScenes ?? [];
      setScenes(
        body.scenes.map((prompt, i) => ({
          prompt,
          narration: narrations[i] ?? "",
          withCharacter: shown[i] !== false,
        })),
      );
      setTitle(body.title ?? "");
      setStyle(body.style ?? "");
      setCharacter(body.character ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not write scenes.");
    } finally {
      setPlanning(false);
    }
  }

  /** Starts the story. Resolves to false if it could not be started. */
  async function create(): Promise<boolean> {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          style,
          scenes: filled.map((s) => s.prompt),
          narrations: filled.map((s) => s.narration),
          characterScenes: filled.map((s) => s.withCharacter),
          voiceId,
          subtitles,
          fade,
          music: music?.data,
          videoModelId,
          character: useCharacter ? character : "",
          characterImage: useCharacter ? characterPhoto : null,
          aspect,
          duration,
          cameraId,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Server returned ${res.status}`);
      }
      await reload();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function createAndShow() {
    if (await create()) setTab("stories");
  }

  const sceneCounts = Array.from({ length: MAX_SCENES - MIN_SCENES + 1 }, (_, i) => i + MIN_SCENES);

  return (
    <div>
      <header className="mb-8 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Story</h1>
        <p className="mt-1 text-base text-muted">
          Write the scenes, pick a look and a voice. Each scene is drawn, animated and joined into
          one video.
        </p>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="space-y-8 p-6">
          <div className="space-y-4">
            <SectionTitle>Start</SectionTitle>
            <Field
              label="Your idea"
              hint={
                plannerReady
                  ? "Works best for short stories. For long ones, paste a script instead."
                  : "Ollama is not running, so scenes cannot be written for you. Type them or paste a script."
              }
            >
              <Textarea
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                rows={3}
                maxLength={12000}
                placeholder="An old fisherman finds a glowing bottle and follows its light to a hidden island"
              />
            </Field>
            <div className="flex gap-2">
              <div className="w-32 shrink-0">
                <Select
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  aria-label="Number of scenes to write"
                >
                  {sceneCounts.map((n) => (
                    <option key={n} value={n}>
                      {n} scenes
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                className="min-w-0 flex-1"
                disabled={!plannerReady || planning || !idea.trim()}
                onClick={() => void plan()}
              >
                {planning ? "Writing…" : "Write the scenes"}
              </Button>
            </div>

            <Field label="Or start from an example" hint="Loads a finished script you can edit before creating.">
              <Select
                value=""
                onChange={(e) => {
                  const example = EXAMPLES.find((item) => item.id === e.target.value);
                  if (example) loadScript(example.script);
                }}
              >
                <option value="">Choose an example…</option>
                {EXAMPLES.map((example) => (
                  <option key={example.id} value={example.id}>
                    {example.name}
                  </option>
                ))}
              </Select>
            </Field>

            <details className="rounded-lg border border-line">
              <summary className="cursor-pointer rounded-lg px-3 py-2.5 text-sm text-muted transition-colors hover:text-white">
                Paste a full script
              </summary>
              <div className="space-y-3 border-t border-line p-3">
                <p className="text-xs leading-relaxed text-muted">
                  One scene per line, written as <code>picture || voice</code>. Start a line with{" "}
                  <code>~</code> if the main character is not in it. Optional first lines:{" "}
                  <code>Title:</code> <code>Character:</code> <code>Style:</code>
                </p>
                <Textarea
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  rows={5}
                  aria-label="Script"
                  placeholder={"Title: My story\n1. She walks into the forest || One day she left home."}
                  className="text-xs"
                />
                <Button block disabled={!pasted.trim()} onClick={() => loadScript()}>
                  Load script
                </Button>
              </div>
            </details>
          </div>

          <div className="space-y-4">
            <SectionTitle>Look</SectionTitle>
            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="Named after the first scene if empty"
              />
            </Field>
            <Field label="Main character">
              <Textarea
                value={character}
                onChange={(e) => setCharacter(e.target.value)}
                rows={2}
                maxLength={400}
                placeholder="a small round red robot with one big blue eye"
              />
            </Field>
            <Group
              label="Or use your own picture"
              hint="A photo of a person, a pet or a product. Every scene is then drawn from it, so it works for a recurring presenter or a product advert."
            >
              <input
                ref={photoInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  void choosePhoto(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {characterPhoto ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={characterPhoto}
                    alt="Your character picture"
                    className="size-16 shrink-0 rounded-lg border border-line object-cover"
                  />
                  <Button size="sm" onClick={() => setCharacterPhoto(null)}>
                    Remove
                  </Button>
                </div>
              ) : (
                <Button block disabled={!characterReady} onClick={() => photoInput.current?.click()}>
                  Choose a picture
                </Button>
              )}
            </Group>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={consistent && characterReady}
                disabled={!characterReady}
                onChange={(e) => setConsistent(e.target.checked)}
                className="mt-0.5 shrink-0"
              />
              <span>
                Keep the character the same in every scene
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                  {characterReady
                    ? "Drawn once, then redrawn into each scene from that picture."
                    : "Needs the FLUX Kontext model, which is not installed."}
                </span>
              </span>
            </label>
            <Field label="Visual style">
              <Input
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                maxLength={200}
                placeholder="cinematic 35mm film, warm golden light"
              />
            </Field>
          </div>

          <div className="space-y-4">
            <SectionTitle>Format</SectionTitle>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Aspect ratio">
                <Select value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)}>
                  {ASPECTS.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Seconds per scene">
                <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                  {durations.map((d) => (
                    <option key={d} value={d}>
                      {d} seconds
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Video quality">
              <Select value={videoModel?.id ?? ""} onChange={(e) => setVideoModelId(e.target.value)}>
                {videoModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Voice"
              hint={voiceReady ? undefined : "The voice engine is not installed."}
            >
              <Select value={voiceId} disabled={!voiceReady} onChange={(e) => setVoiceId(e.target.value)}>
                <option value="">No voice (silent video)</option>
                {VOICES.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.language} · {voice.name}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={subtitles}
                onChange={(e) => setSubtitles(e.target.checked)}
                className="mt-0.5 shrink-0"
              />
              <span>
                Show subtitles
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                  Each scene&apos;s line is written at the bottom of the picture. Works with or
                  without a voice.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={fade}
                onChange={(e) => setFade(e.target.checked)}
                className="mt-0.5 shrink-0"
              />
              <span>
                Fade between scenes
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                  Each scene fades in from black and out again, instead of a hard cut.
                </span>
              </span>
            </label>
            <Group
              label="Background music"
              hint="Your own MP3, WAV, M4A or OGG. It plays quietly under the voice and loops if it is short."
            >
              <input
                ref={musicInput}
                type="file"
                accept="audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/ogg,.mp3,.wav,.m4a,.ogg"
                className="hidden"
                onChange={(e) => {
                  chooseMusic(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {music ? (
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate rounded-lg border border-line bg-ink px-3 py-2 text-sm">
                    {music.name}
                  </span>
                  <Button size="sm" onClick={() => setMusic(null)}>
                    Remove
                  </Button>
                </div>
              ) : (
                <Button block onClick={() => musicInput.current?.click()}>
                  Choose a music file
                </Button>
              )}
            </Group>
            <Field label="Camera">
              <Select value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
                <option value="auto">Vary the move per scene</option>
                {CAMERAS.map((cam) => (
                  <option key={cam.id} value={cam.id}>
                    {cam.name} in every scene
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="space-y-3 border-t border-line pt-6">
            <Button
              variant="primary"
              block
              disabled={submitting || blocker !== null}
              onClick={() => void createAndShow()}
            >
              {submitting ? "Starting…" : "Create story video"}
            </Button>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : blocker ? (
              <p className="text-sm text-muted">{blocker}</p>
            ) : (
              <p className="text-sm text-muted">
                <span className="text-white">
                  {filled.length} scenes, {filled.length * duration} seconds of video.
                </span>{" "}
                Ready in {formatMinutes(estimate)}.
              </p>
            )}
          </div>
        </Card>

        <div className="min-w-0 space-y-6">
          <Segmented
            label="View"
            value={tab}
            onChange={setTab}
            options={[
              { value: "scenes", label: `Scenes (${filled.length})` },
              { value: "stories", label: `Your stories (${stories.length})` },
            ]}
          />

          {tab === "scenes" ? (
            <Card className="animate-rise divide-y divide-line">
              {scenes.map((scene, i) => (
                <div key={i} className="animate-rise flex gap-4 p-4 sm:p-6">
                  <span
                    aria-hidden
                    className="grid size-8 shrink-0 place-items-center rounded-lg bg-raised text-sm font-medium tabular-nums text-neon"
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-3">
                    <Textarea
                      value={scene.prompt}
                      onChange={(e) => setScene(i, { prompt: e.target.value })}
                      rows={2}
                      maxLength={600}
                      aria-label={`Scene ${i + 1}: what is visible`}
                      placeholder="What is visible in this shot?"
                    />
                    {(voiceId || subtitles) && (
                      <div className="flex items-center gap-3">
                        <Input
                          value={scene.narration}
                          onChange={(e) => setScene(i, { narration: e.target.value })}
                          maxLength={300}
                          aria-label={`Scene ${i + 1}: what is said`}
                          placeholder="Narration, or dialogue: He: Stay. She: Always."
                        />
                        <span
                          title={`About ${wordBudget} words fit in ${duration} seconds. Longer lines are sped up, then cut.`}
                          className={`w-12 shrink-0 text-right text-xs tabular-nums ${
                            spokenWords(scene.narration) > wordBudget ? "font-medium text-danger" : "text-muted"
                          }`}
                        >
                          {spokenWords(scene.narration)}/{wordBudget}
                        </span>
                      </div>
                    )}
                    {useCharacter && (
                      <label className="flex items-center gap-2 text-xs text-muted">
                        <input
                          type="checkbox"
                          checked={scene.withCharacter}
                          onChange={(e) => setScene(i, { withCharacter: e.target.checked })}
                        />
                        Main character is in this scene
                      </label>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={scenes.length <= MIN_SCENES}
                    onClick={() => setScenes((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Remove scene ${i + 1}`}
                    className="w-8 shrink-0 px-0 text-base"
                  >
                    ×
                  </Button>
                </div>
              ))}
              <div className="p-4 sm:px-6">
                <Button
                  disabled={scenes.length >= MAX_SCENES}
                  onClick={() => setScenes((prev) => [...prev, EMPTY_SCENE])}
                >
                  Add scene
                </Button>
                {scenes.length >= MAX_SCENES && (
                  <span className="ml-3 text-xs text-muted">{MAX_SCENES} scenes is the maximum.</span>
                )}
              </div>
            </Card>
          ) : loaded && stories.length === 0 ? (
            <EmptyState title="No stories yet">
              Write your scenes, then press Create story video.
            </EmptyState>
          ) : (
            <div className="stagger space-y-6">
              {stories.map((story) => (
                <StoryCard
                  key={story.id}
                  story={story}
                  onDelete={() => void remove(story.id)}
                  onResume={() => void resume(story.id)}
                  onRedo={(scene) => void redo(story.id, scene)}
                  onEdit={() => loadStory(story)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function statusLine(story: StoryView): string {
  if (story.status === "done") {
    const extras = [
      story.voiced ? "voice" : "",
      story.subtitled ? "subtitles" : "",
      story.scored ? "music" : "",
    ].filter(Boolean);
    return `${story.scenes.length * story.duration} seconds${extras.length ? `, with ${extras.join(" and ")}` : ""}`;
  }
  if (story.status === "failed") return "Stopped before finishing";
  if (story.status === "joining") {
    return story.voiced ? "Recording the voice and joining clips…" : "Joining clips…";
  }
  const stills = story.scenes.filter((s) => s.stage !== "image").length;
  const clips = story.scenes.filter((s) => s.stage === "done").length;
  const left = story.etaSeconds ? `, ${formatMinutes(story.etaSeconds)} left` : "";
  return stills < story.scenes.length
    ? `Drawing stills: ${stills} of ${story.scenes.length} done${left}`
    : `Animating scenes: ${clips} of ${story.scenes.length} done${left}`;
}

/** Index of the scene the GPU is working on now (jobs run one at a time, in order). */
function activeScene(story: StoryView): number {
  if (story.status !== "running") return -1;
  const drawing = story.scenes.findIndex((s) => s.stage === "image");
  return drawing >= 0 ? drawing : story.scenes.findIndex((s) => s.stage === "video");
}

const STATUS_BADGE: Record<StoryView["status"], { tone: "accent" | "success" | "danger"; label: string }> = {
  running: { tone: "accent", label: "Rendering" },
  joining: { tone: "accent", label: "Finishing" },
  done: { tone: "success", label: "Ready" },
  failed: { tone: "danger", label: "Stopped" },
};

interface StoryCardProps {
  story: StoryView;
  onDelete: () => void;
  onResume: () => void;
  /** Remake one scene (0-based) and join the video again. */
  onRedo: (scene: number) => void;
  /** Load this story into the editor to change it and make a new version. */
  onEdit: () => void;
}

function StoryCard({ story, onDelete, onResume, onRedo, onEdit }: StoryCardProps) {
  const ratio = story.aspect.replace(":", " / ");
  const active = story.status === "running" || story.status === "joining";
  const badge = STATUS_BADGE[story.status];
  const current = activeScene(story);

  return (
    <Card className="overflow-hidden">
      {story.status === "done" && story.outputUrl && (
        <video
          src={story.outputUrl}
          controls
          loop
          playsInline
          className="max-h-[70vh] w-full bg-black"
          style={{ aspectRatio: ratio }}
        />
      )}

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h2 className="truncate text-lg font-semibold tracking-tight">{story.title}</h2>
              <Badge tone={badge.tone} live={active}>
                {badge.label}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted">{statusLine(story)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {story.status === "done" && story.outputUrl && (
              <a
                href={story.outputUrl}
                download={`${story.title}.mp4`}
                className="inline-flex h-8 items-center rounded-lg border border-edge px-3 text-sm transition-colors hover:border-muted hover:bg-raised"
              >
                Download
              </a>
            )}
            {story.status === "failed" && (
              <Button variant="primary" size="sm" onClick={onResume}>
                Resume
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              title="Load these scenes and settings into the editor to change them and make a new version"
            >
              Edit and remake
            </Button>
            <ConfirmDelete onConfirm={onDelete} />
          </div>
        </div>

        {active && <ProgressBar value={story.progress} />}

        {story.status === "failed" && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-danger">
            {story.error} Finished scenes are kept. Press Resume to continue from here.
          </p>
        )}

        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-6">
          {story.consistent && (
            <figure title="Character reference: every scene is drawn from this picture.">
              <div className="overflow-hidden rounded-lg border border-accent/60" style={{ aspectRatio: ratio }}>
                {story.characterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={story.characterUrl} alt="Character reference" className="size-full object-cover" />
                ) : (
                  <div className="shimmer size-full" />
                )}
              </div>
              <figcaption className="mt-1.5 truncate text-xs text-accent">Character</figcaption>
            </figure>
          )}
          {story.scenes.map((scene, i) => (
            <SceneTile
              key={i}
              scene={scene}
              index={i}
              ratio={ratio}
              active={i === current}
              onRedo={story.status === "done" || story.status === "failed" ? () => onRedo(i) : undefined}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

const STAGE_LABEL: Record<SceneView["stage"], string> = {
  image: "Drawing",
  video: "Animating",
  done: "Done",
  failed: "Failed",
};

interface SceneTileProps {
  scene: SceneView;
  index: number;
  ratio: string;
  /** This scene is the one rendering right now. */
  active: boolean;
  /** Set when the scene can be remade (the story is not rendering). */
  onRedo?: () => void;
}

function SceneTile({ scene, index, ratio, active, onRedo }: SceneTileProps) {
  const pending = scene.stage === "image" || scene.stage === "video";
  const label = pending && !active ? "Waiting" : STAGE_LABEL[scene.stage];
  const tooltip = [
    scene.prompt,
    `Camera: ${getCamera(scene.cameraId).name}`,
    scene.narration ? `Voice: ${scene.narration}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <figure title={tooltip}>
      <div
        className={`overflow-hidden rounded-lg border transition-colors duration-300 ${
          scene.stage === "failed" ? "border-danger" : active ? "pulse-ring border-accent" : "border-line"
        }`}
        style={{ aspectRatio: ratio }}
      >
        {scene.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={scene.imageUrl}
            alt={scene.prompt}
            className={`animate-rise size-full object-cover transition-opacity duration-500 ${
              scene.stage === "video" ? "opacity-60" : ""
            }`}
          />
        ) : (
          <div className={`size-full ${scene.stage === "failed" ? "bg-danger/10" : "shimmer"}`} />
        )}
      </div>
      <figcaption
        className={`mt-1.5 truncate text-xs tabular-nums ${
          scene.stage === "failed" ? "text-danger" : active ? "text-accent" : "text-muted"
        }`}
      >
        {index + 1} · {label}
        {active ? "…" : ""}
      </figcaption>
      {onRedo && (
        <button
          type="button"
          onClick={onRedo}
          title="Draw and animate this scene again, then rebuild the video"
          className="mt-0.5 rounded text-xs text-muted underline-offset-4 transition-colors hover:text-white hover:underline"
        >
          Redo scene {index + 1}
        </button>
      )}
    </figure>
  );
}
