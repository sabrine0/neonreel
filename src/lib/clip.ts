// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Small FFmpeg jobs on a single clip. All of them drop sound: generated clips are silent. */
const run = promisify(execFile);

const ENCODE = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", "-an"];

async function ffmpeg(args: string[]): Promise<void> {
  try {
    await run("ffmpeg", ["-y", "-v", "error", ...args], { windowsHide: true });
  } catch (err) {
    const detail = (err as { stderr?: string; code?: string }) ?? {};
    if (detail.code === "ENOENT") throw new Error("FFmpeg is not installed.");
    const lines = (detail.stderr ?? "").trim().split(/\r?\n/);
    throw new Error(lines[lines.length - 1]?.slice(0, 300) || "FFmpeg failed.");
  }
}

interface Shape {
  width: number;
  height: number;
  /** Frame rate as FFmpeg writes it, for example "24/1". */
  fps: string;
}

async function shapeOf(file: string): Promise<Shape> {
  const { stdout } = await run(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "csv=p=0", file],
    { windowsHide: true },
  );
  const [width, height, fps] = stdout.trim().split(",");
  if (!Number(width) || !Number(height) || !/^\d+\/\d+$/.test(fps ?? "")) {
    throw new Error("That clip could not be read.");
  }
  return { width: Number(width), height: Number(height), fps };
}

/** Saves the final frame of a clip as a picture. */
export async function lastFrame(clip: string, out: string): Promise<void> {
  // Reads only the last second and keeps overwriting, so the last frame wins.
  await ffmpeg(["-sseof", "-1", "-i", clip, "-update", "1", "-frames:v", "1000", out]);
}

/**
 * Joins `next` onto the end of `first`. `next` starts on the last frame of
 * `first`, so its first frame is dropped; it is resized to match if needed.
 */
export async function appendClip(first: string, next: string, out: string): Promise<void> {
  const { width, height, fps } = await shapeOf(first);
  const filter =
    `[0:v]fps=${fps},setsar=1[a];` +
    `[1:v]scale=${width}:${height},fps=${fps},setsar=1,trim=start_frame=1,setpts=PTS-STARTPTS[b];` +
    `[a][b]concat=n=2:v=1:a=0[v]`;
  await ffmpeg(["-i", first, "-i", next, "-filter_complex", filter, "-map", "[v]", ...ENCODE, out]);
}

/**
 * Fits a video into a frame of another shape without cutting anything off:
 * the whole picture is centred over a blurred, enlarged copy of itself.
 * Sound is kept.
 */
export async function fitClip(clip: string, out: string, width: number, height: number): Promise<void> {
  const shape = await shapeOf(clip);
  const size = `${width}:${height}`;
  const sameShape = Math.abs(shape.width / shape.height - width / height) < 0.02;
  const filter = sameShape
    ? `[0:v]scale=${size},setsar=1[v]`
    : `[0:v]split[a][b];` +
      `[a]scale=${size}:force_original_aspect_ratio=increase,crop=${size},boxblur=24:2,eq=brightness=-0.12[bg];` +
      `[b]scale=${size}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`;
  await ffmpeg([
    "-i", clip,
    "-filter_complex", filter,
    "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "veryfast",
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart",
    out,
  ]);
}

export async function reverseClip(clip: string, out: string): Promise<void> {
  await ffmpeg(["-i", clip, "-vf", "reverse", ...ENCODE, out]);
}

/** Forward then backward, so the clip repeats with no jump. */
export async function loopClip(clip: string, out: string): Promise<void> {
  // The backward half skips its first frame, which would repeat the turning point.
  const filter =
    "[0:v]split[a][b];[b]reverse,trim=start_frame=1,setpts=PTS-STARTPTS[r];[a][r]concat=n=2:v=1:a=0[v]";
  await ffmpeg(["-i", clip, "-filter_complex", filter, "-map", "[v]", ...ENCODE, out]);
}

/** Half speed. */
export async function slowClip(clip: string, out: string): Promise<void> {
  await ffmpeg(["-i", clip, "-vf", "setpts=2*PTS", ...ENCODE, out]);
}
