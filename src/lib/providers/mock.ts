// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { ASPECT_SIZE } from "../catalog";
import { saveFile } from "../store";
import type { Generation } from "../types";
import type { Provider } from "./types";

const IMAGE_MS = 2500;
const VIDEO_MS = 6000;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic abstract landscape derived from the prompt. */
function renderSvg(gen: Generation): string {
  const [w, h] = ASPECT_SIZE[gen.aspect];
  let seed = hash(gen.prompt || gen.id);
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const hue = Math.floor(rnd() * 360);
  const hue2 = (hue + 40 + Math.floor(rnd() * 80)) % 360;
  const horizon = h * (0.5 + rnd() * 0.2);
  const sunX = w * (0.2 + rnd() * 0.6);
  const sunR = Math.min(w, h) * (0.08 + rnd() * 0.1);

  const ridges = [0, 1, 2]
    .map((layer) => {
      const base = horizon + layer * h * 0.09;
      const points: string[] = [`0,${h}`];
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        const y = base - rnd() * h * (0.16 - layer * 0.04);
        points.push(`${((w / steps) * i).toFixed(0)},${y.toFixed(0)}`);
      }
      points.push(`${w},${h}`);
      const light = 22 - layer * 7;
      return `<polygon points="${points.join(" ")}" fill="hsl(${hue2} 35% ${light}%)"/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="hsl(${hue} 60% 16%)"/>
<stop offset="0.65" stop-color="hsl(${hue2} 70% 52%)"/>
<stop offset="1" stop-color="hsl(${hue2} 80% 72%)"/>
</linearGradient>
<radialGradient id="sun"><stop offset="0" stop-color="#fff" stop-opacity="0.95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${w}" height="${h}" fill="url(#sky)"/>
<circle cx="${sunX.toFixed(0)}" cy="${(horizon - sunR).toFixed(0)}" r="${(sunR * 2.4).toFixed(0)}" fill="url(#sun)"/>
<circle cx="${sunX.toFixed(0)}" cy="${(horizon - sunR).toFixed(0)}" r="${sunR.toFixed(0)}" fill="#fff" fill-opacity="0.9"/>
${ridges}
<text x="${w - 16}" y="${h - 16}" text-anchor="end" font-family="monospace" font-size="${Math.round(h / 45)}" fill="#fff" fill-opacity="0.45">DEMO RENDER</text>
</svg>`;
}

/**
 * Keyless stand-in for a real model, so the whole pipeline (queue, polling,
 * credits, library) works end to end. Images are procedural SVGs; "videos"
 * are a still frame the browser animates with the chosen camera preset.
 */
export const mockProvider: Provider = {
  async submit() {
    return {};
  },

  async check(gen) {
    const needed = gen.kind === "image" ? IMAGE_MS : VIDEO_MS;
    const elapsed = Date.now() - gen.createdAt;
    if (elapsed < needed) {
      return { status: "running", progress: elapsed / needed };
    }
    if (gen.kind === "image") {
      return {
        status: "done",
        outputUrl: saveFile(`${gen.id}.svg`, renderSvg(gen)),
        outputType: "image",
      };
    }
    return {
      status: "done",
      outputUrl: gen.refImage ?? saveFile(`${gen.id}.svg`, renderSvg(gen)),
      outputType: "motion",
    };
  },
};
