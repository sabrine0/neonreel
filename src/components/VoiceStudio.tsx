// Neonreel - made by sabrine0 (https://github.com/sabrine0)
"use client";

import { useState } from "react";
import { VOICES, getVoice } from "@/lib/catalog";
import { Button, Card, EmptyState, Field, Select, Textarea } from "./ui";

interface Clip {
  url: string;
  text: string;
  voiceId: string;
}

const MAX_CHARS = 3000;

/** Text to speech as a tool of its own: type, pick a voice, get an MP3. */
export function VoiceStudio({ ready }: { ready: boolean }) {
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState(VOICES[0].id);
  const [clips, setClips] = useState<Clip[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function speak() {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId }),
      });
      const body = (await res.json().catch(() => null)) as (Clip & { error?: string }) | null;
      if (!res.ok || !body?.url) throw new Error(body?.error ?? `Server returned ${res.status}`);
      setClips((prev) => [{ url: body.url, text: body.text, voiceId: body.voiceId }, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setWorking(false);
    }
  }

  const blocker = !ready
    ? "The voice engine is not installed. See the setup guide."
    : !text.trim()
      ? "Type something to say."
      : null;

  return (
    <div>
      <header className="mb-8 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Voice</h1>
        <p className="mt-1 text-base text-muted">
          Turn text into speech. It runs on this computer, so it is free and works offline.
        </p>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="space-y-6 p-6">
          <Field
            label="Text"
            hint={
              <>
                For a conversation, start each part with <code>He:</code> <code>She:</code>{" "}
                <code>Child:</code> or <code>Narrator:</code> and each speaker gets a different voice.
              </>
            }
          >
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              maxLength={MAX_CHARS}
              placeholder="Once upon a time, in a city of neon light…"
            />
          </Field>
          <Field label="Voice">
            <Select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
              {VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.language} · {voice.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="space-y-3 border-t border-line pt-6">
            <Button variant="primary" block disabled={working || blocker !== null} onClick={() => void speak()}>
              {working ? "Speaking…" : "Create speech"}
            </Button>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : (
              <p className="text-sm text-muted">
                {blocker ?? `${text.length} of ${MAX_CHARS} characters`}
              </p>
            )}
          </div>
        </Card>

        <div className="min-w-0 space-y-4">
          {clips.length === 0 ? (
            <EmptyState title="No speech yet">Your recordings from this visit appear here.</EmptyState>
          ) : (
            clips.map((clip) => (
              <Card key={clip.url} className="animate-rise space-y-3 p-4">
                <audio src={clip.url} controls className="w-full" />
                <p className="line-clamp-3 text-sm">{clip.text}</p>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted">
                    {getVoice(clip.voiceId)?.language} · {getVoice(clip.voiceId)?.name}
                  </p>
                  <a
                    href={clip.url}
                    download="neonreel-voice.mp3"
                    className="inline-flex h-8 items-center rounded-lg border border-edge px-3 text-sm transition-colors hover:border-neon"
                  >
                    Download
                  </a>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
