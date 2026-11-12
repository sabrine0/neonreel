// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import fs from "node:fs";
import path from "node:path";
import type { Generation, Story } from "./types";

/**
 * Single-user JSON file store. Good enough for local use; swap for a real
 * database (and per-user rows) before deploying this anywhere shared.
 */
// turbopackIgnore stops the bundler tracing .data as a source dependency;
// without it every write here triggers a recompile and a page refresh in dev.
const DIR = path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
const FILES = path.join(DIR, "files");
const DB = path.join(DIR, "db.json");

const STARTING_CREDITS = 500;

interface Db {
  credits: number;
  generations: Generation[];
  stories: Story[];
}

function load(): Db {
  try {
    const db = JSON.parse(fs.readFileSync(DB, "utf8")) as Db;
    db.stories ??= [];
    return db;
  } catch {
    return { credits: STARTING_CREDITS, generations: [], stories: [] };
  }
}

function save(db: Db): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(DB, JSON.stringify(db, null, 2));
}

export function listGenerations(): Generation[] {
  return load().generations.sort((a, b) => b.createdAt - a.createdAt);
}

export function getGeneration(id: string): Generation | undefined {
  return load().generations.find((g) => g.id === id);
}

export function insertGeneration(gen: Generation): void {
  const db = load();
  db.generations.push(gen);
  save(db);
}

export function updateGeneration(id: string, patch: Partial<Generation>): void {
  const db = load();
  const gen = db.generations.find((g) => g.id === id);
  if (!gen) return;
  Object.assign(gen, patch);
  save(db);
}

export function deleteGeneration(id: string): boolean {
  const db = load();
  const before = db.generations.length;
  db.generations = db.generations.filter((g) => g.id !== id);
  save(db);
  return db.generations.length < before;
}

export function listStories(): Story[] {
  return load().stories.sort((a, b) => b.createdAt - a.createdAt);
}

export function getStory(id: string): Story | undefined {
  return load().stories.find((s) => s.id === id);
}

export function insertStory(story: Story): void {
  const db = load();
  db.stories.push(story);
  save(db);
}

export function updateStory(id: string, patch: Partial<Story>): void {
  const db = load();
  const story = db.stories.find((s) => s.id === id);
  if (!story) return;
  Object.assign(story, patch);
  save(db);
}

export function deleteStory(id: string): boolean {
  const db = load();
  const before = db.stories.length;
  db.stories = db.stories.filter((s) => s.id !== id);
  save(db);
  return db.stories.length < before;
}

export function getCredits(): number {
  return load().credits;
}

export function addCredits(delta: number): number {
  const db = load();
  db.credits += delta;
  save(db);
  return db.credits;
}

const SAFE_NAME = /^[a-z0-9-]+\.(svg|jpg|png|webp|mp4|mp3|wav|m4a|ogg)$/;

export function saveFile(name: string, data: Buffer | string): string {
  if (!SAFE_NAME.test(name)) throw new Error("Invalid file name");
  fs.mkdirSync(FILES, { recursive: true });
  fs.writeFileSync(path.join(FILES, name), data);
  return `/api/files/${name}`;
}

/** Absolute path of a stored file, for tools that need one (FFmpeg). */
export function filePath(name: string): string {
  if (!SAFE_NAME.test(name)) throw new Error("Invalid file name");
  fs.mkdirSync(FILES, { recursive: true });
  return path.join(FILES, name);
}

export function readFile(name: string): Buffer | undefined {
  if (!SAFE_NAME.test(name)) return undefined;
  try {
    return fs.readFileSync(path.join(FILES, name));
  } catch {
    return undefined;
  }
}

export function removeFile(name: string): void {
  if (!SAFE_NAME.test(name)) return;
  fs.rmSync(path.join(FILES, name), { force: true });
}
