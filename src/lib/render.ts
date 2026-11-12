import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { splitDialogue, type SpokenPart } from "./catalog";

const run = promisify(execFile);

const ROOT = /* turbopackIgnore: true */ process.cwd();
const TTS_PYTHON = path.join(
  ROOT,
  ".tts",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const TTS_SCRIPT = path.join(ROOT, "tools", "tts.py");
const TTS_MODEL = path.join(ROOT, ".tts", "models", "kokoro-v1.0.onnx");

/** Pause before a line starts, so speech does not land exactly on the cut. */
const LEAD_IN_SECONDS = 0.15;
/** Pause between two speakers in the same scene. */
const PART_GAP_SECONDS = 0.2;
/** Lines that overrun their scene are sped up, at most this much, then cut. */
const MAX_TEMPO = 1.4;
/** How long a subtitle stays after its line has been spoken. */
const SUBTITLE_LINGER_SECONDS = 0.4;
const SUBTITLE_FILE = "subtitles.ass";
/** Length of the fade to and from black at each cut. */
const FADE_SECONDS = 0.3;
/** Music level under a voice, and on its own. */
const MUSIC_UNDER_VOICE = 0.16;
const MUSIC_ALONE = 0.55;

/** True when the local text-to-speech engine (Kokoro, in .tts/) is installed. */
export function voiceAvailable(): boolean {
  return fs.existsSync(TTS_PYTHON) && fs.existsSync(TTS_MODEL);
}

async function ffmpeg(args: string[], cwd?: string): Promise<void> {
  try {
    await run("ffmpeg", ["-y", "-v", "error", ...args], { windowsHide: true, cwd });
  } catch (err) {
    const failure = err as NodeJS.ErrnoException & { stderr?: string };
    if (failure.code === "ENOENT") throw new Error("FFmpeg was not found on PATH.");
    throw new Error(`FFmpeg failed. ${(failure.stderr ?? "").trim().slice(0, 300)}`);
  }
}

async function probe(file: string, entries: string, stream?: string): Promise<string> {
  const args = ["-v", "error", ...(stream ? ["-select_streams", stream] : [])];
  const { stdout } = await run("ffprobe", [...args, "-show_entries", entries, "-of", "csv=p=0", file], {
    windowsHide: true,
  });
  return stdout.trim();
}

async function durationOf(file: string): Promise<number> {
  const seconds = Number(await probe(file, "format=duration"));
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Could not read duration of ${file}`);
  return seconds;
}

async function sizeOf(file: string): Promise<[number, number]> {
  const [width, height] = (await probe(file, "stream=width,height", "v:0")).split(",").map(Number);
  if (!width || !height) throw new Error(`Could not read size of ${file}`);
  return [width, height];
}

/** Speaks each line into its own WAV file with the local Kokoro engine. */
async function speak(
  lines: { text: string; out: string; voice?: string }[],
  voiceId: string,
  workDir: string,
) {
  const job = path.join(workDir, "tts-job.json");
  fs.writeFileSync(job, JSON.stringify({ voice: voiceId, speed: 1, lines }));
  try {
    await run(TTS_PYTHON, [TTS_SCRIPT, job], { windowsHide: true, timeout: 10 * 60 * 1000 });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    throw new Error(`Text-to-speech failed. ${stderr.trim().split("\n").pop()?.slice(0, 300) ?? ""}`);
  }
}

/**
 * Speaks a text into one MP3. Speaker tags (He:, She:, Child:, Narrator:)
 * switch voices, as they do in stories.
 */
export async function narrate(text: string, voiceId: string, out: string): Promise<void> {
  const parts = splitDialogue(text, voiceId);
  if (parts.length === 0) throw new Error("There is nothing to say.");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "framewright-"));
  try {
    const jobs = parts.map((part, i) => ({
      text: part.text,
      voice: part.voiceId,
      out: path.join(work, `part-${i}.wav`),
    }));
    await speak(jobs, voiceId, work);
    const encode = ["-c:a", "libmp3lame", "-q:a", "3"];
    if (jobs.length === 1) {
      await ffmpeg(["-i", jobs[0].out, ...encode, out]);
      return;
    }
    const padded = jobs.map((_, i) => `[${i}:a]apad=pad_dur=${PART_GAP_SECONDS}[p${i}]`);
    const labels = jobs.map((_, i) => `[p${i}]`).join("");
    await ffmpeg([
      ...jobs.flatMap((job) => ["-i", job.out]),
      "-filter_complex",
      `${padded.join(";")};${labels}concat=n=${jobs.length}:v=0:a=1[out]`,
      "-map", "[out]",
      ...encode,
      out,
    ]);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export interface JoinOptions {
  /** One line per clip (may hold dialogue tags); empty string for none. */
  lines?: string[];
  /** Speak the lines with this narrator voice. Unset for a silent video. */
  voiceId?: string;
  /** Burn the lines into the picture as subtitles. */
  subtitles?: boolean;
  /** Fade each scene in from black and out to black instead of cutting. */
  fade?: boolean;
  /** Path of an audio file played under the whole video, looped if it is shorter. */
  music?: string;
}

interface Cue {
  start: number;
  end: number;
  text: string;
}

function assTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 100));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${Math.floor(total / 360000)}:${pad(Math.floor(total / 6000) % 60)}:${pad(Math.floor(total / 100) % 60)}.${pad(total % 100)}`;
}

/** Subtitle text for one scene: dialogue gets one dashed line per speaker. */
function cueText(parts: SpokenPart[]): string {
  const clean = (text: string) => text.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();
  return parts.length > 1
    ? parts.map((part) => `- ${clean(part.text)}`).join("\\N")
    : clean(parts[0].text);
}

/** Writes an ASS subtitle file sized to the video, bottom centre, white on a soft outline. */
function writeSubtitles(file: string, cues: Cue[], width: number, height: number): void {
  const size = Math.round(height * 0.05);
  const margin = Math.round(height * 0.06);
  const side = Math.round(width * 0.08);
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Arial,${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(size / 14))},1,2,${side},${side},${margin},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = cues.map(
    (cue) => `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${cue.text}`,
  );
  fs.writeFileSync(file, [...header, ...events, ""].join("\n"), "utf8");
}

/**
 * Concatenates clips into one MP4. Each scene's line can be spoken (placed at
 * the start of its own clip, so voice and picture stay in step) and/or burned
 * in as a subtitle.
 */
export async function joinClips(clips: string[], out: string, options: JoinOptions = {}): Promise<void> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "framewright-"));
  try {
    const list = path.join(work, "clips.txt");
    fs.writeFileSync(
      list,
      clips.map((clip) => `file '${clip.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"),
    );
    const video = ["-f", "concat", "-safe", "0", "-i", list];
    // Re-encode so clips from different runs always join cleanly.
    const encode = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart"];

    // A line can hold several speakers; each part is spoken in its own voice.
    const parts = clips.map((_, i) => splitDialogue(options.lines?.[i] ?? "", options.voiceId ?? ""));
    const hasLines = parts.some((scene) => scene.length > 0);
    const voiced = Boolean(options.voiceId) && hasLines;
    const captioned = Boolean(options.subtitles) && hasLines;
    const faded = Boolean(options.fade);
    const music = options.music && fs.existsSync(options.music) ? options.music : undefined;

    if (!voiced && !captioned && !faded && !music) {
      await ffmpeg([...video, ...encode, "-an", out]);
      return;
    }

    const lengths = await Promise.all(clips.map(durationOf));
    const total = lengths.reduce((sum, length) => sum + length, 0);

    // One speech file per scene: its parts back to back with a short breath between.
    const speech: (string | undefined)[] = clips.map(() => undefined);
    if (voiced) {
      const jobs = parts.map((scene, i) =>
        scene.map((part, j) => ({
          text: part.text,
          voice: part.voiceId,
          out: path.join(work, `line-${i}-${j}.wav`),
        })),
      );
      await speak(jobs.flat(), options.voiceId ?? "", work);
      for (const [i, scene] of jobs.entries()) {
        if (scene.length === 0) continue;
        const merged = path.join(work, `line-${i}.wav`);
        if (scene.length === 1) {
          fs.renameSync(scene[0].out, merged);
        } else {
          const padded = scene.map((_, j) => `[${j}:a]apad=pad_dur=${PART_GAP_SECONDS}[p${j}]`);
          const labels = scene.map((_, j) => `[p${j}]`).join("");
          await ffmpeg([
            ...scene.flatMap((part) => ["-i", part.out]),
            "-filter_complex",
            `${padded.join(";")};${labels}concat=n=${scene.length}:v=0:a=1[out]`,
            "-map", "[out]",
            merged,
          ]);
        }
        speech[i] = merged;
      }
    }

    // Picture: one joined stream, or every clip on its own input so each can fade.
    const inputs: string[] = faded ? clips.flatMap((clip) => ["-i", clip]) : [...video];
    const filters: string[] = [];
    let picture = "0:v";
    if (faded) {
      clips.forEach((_, i) => {
        const fadeOut = Math.max(0, lengths[i] - FADE_SECONDS).toFixed(3);
        filters.push(
          `[${i}:v]fade=t=in:st=0:d=${FADE_SECONDS},fade=t=out:st=${fadeOut}:d=${FADE_SECONDS},setsar=1[v${i}]`,
        );
      });
      filters.push(`${clips.map((_, i) => `[v${i}]`).join("")}concat=n=${clips.length}:v=1:a=0[vcat]`);
      picture = "[vcat]";
    }
    /** Index the next added input will have. */
    let nextInput = faded ? clips.length : 1;

    // Build one audio segment per clip, exactly as long as the clip, and time the subtitles.
    const cues: Cue[] = [];
    let offset = 0;
    for (const [i, length] of lengths.entries()) {
      const input = nextInput;
      const file = speech[i];
      let spokenFor = length - LEAD_IN_SECONDS - 0.1;

      if (file) {
        const room = Math.max(0.5, length - LEAD_IN_SECONDS - 0.1);
        const raw = await durationOf(file);
        const tempo = Math.min(MAX_TEMPO, Math.max(1, raw / room));
        spokenFor = Math.min(room, raw / tempo);
        inputs.push("-i", file);
        nextInput += 1;
        filters.push(
          `[${input}:a]aresample=48000,atempo=${tempo.toFixed(3)},` +
            `adelay=${Math.round(LEAD_IN_SECONDS * 1000)},apad,` +
            `atrim=0:${length.toFixed(3)},asetpts=N/SR/TB[a${i}]`,
        );
      } else if (voiced) {
        inputs.push("-f", "lavfi", "-t", length.toFixed(3), "-i", "anullsrc=r=48000:cl=mono");
        nextInput += 1;
        filters.push(`[${input}:a]asetpts=N/SR/TB[a${i}]`);
      }

      if (captioned && parts[i].length > 0) {
        const start = offset + LEAD_IN_SECONDS;
        // Spoken lines stay a moment after the voice; silent ones fill the scene.
        const end = file
          ? Math.min(offset + length - 0.05, start + spokenFor + SUBTITLE_LINGER_SECONDS)
          : offset + length - 0.1;
        cues.push({ start, end, text: cueText(parts[i]) });
      }
      offset += length;
    }

    if (captioned) {
      const [width, height] = await sizeOf(clips[0]);
      writeSubtitles(path.join(work, SUBTITLE_FILE), cues, width, height);
      // Referenced by bare name with cwd set to the work folder: Windows paths
      // (drive colon, backslashes) cannot be escaped reliably inside a filter.
      filters.push(`[${picture.replace(/[[\]]/g, "")}]subtitles=${SUBTITLE_FILE}[vout]`);
      picture = "[vout]";
    }

    let sound: string | undefined;
    if (voiced) {
      filters.push(
        `${clips.map((_, i) => `[a${i}]`).join("")}concat=n=${clips.length}:v=0:a=1,` +
          "aformat=channel_layouts=stereo[voice]",
      );
      sound = "[voice]";
    }
    if (music) {
      // Looped to cover the video, cut to its length, faded in and out.
      inputs.push("-stream_loop", "-1", "-i", music);
      const level = voiced ? MUSIC_UNDER_VOICE : MUSIC_ALONE;
      const fadeOut = Math.max(0, total - 2).toFixed(3);
      filters.push(
        `[${nextInput}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${level},` +
          `atrim=0:${total.toFixed(3)},afade=t=in:d=1,afade=t=out:st=${fadeOut}:d=2,asetpts=N/SR/TB[music]`,
      );
      nextInput += 1;
      if (sound) {
        filters.push(`${sound}[music]amix=inputs=2:duration=first:normalize=0[mixed]`);
        sound = "[mixed]";
      } else {
        sound = "[music]";
      }
    }

    await ffmpeg(
      [
        ...inputs,
        ...(filters.length > 0 ? ["-filter_complex", filters.join(";")] : []),
        "-map", picture,
        ...(sound ? ["-map", sound, "-c:a", "aac", "-b:a", "192k"] : ["-an"]),
        ...encode,
        out,
      ],
      work,
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
