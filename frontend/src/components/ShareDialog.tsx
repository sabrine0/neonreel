// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { useEffect, useRef, useState } from "react";
import { PLATFORMS } from "@/lib/share";
import { Button, Textarea } from "./ui";

interface Props {
  /** App-relative URL of the finished video. */
  file: string;
  /** What the video is about, for the caption writer. */
  about: string;
  /** Name for the downloaded file, without extension. */
  name: string;
  onClose: () => void;
}

interface Prepared {
  url: string;
  caption: string;
  uploadUrl: string;
}

/**
 * Gets a video ready to publish: a copy in the platform's shape, a caption with
 * hashtags, and a link to the platform's upload page. The user posts it there
 * themselves, so no account is ever connected to this app.
 */
export function ShareDialog({ file, about, name, onClose }: Props) {
  const [platformId, setPlatformId] = useState(PLATFORMS[0].id);
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [caption, setCaption] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const platform = PLATFORMS.find((p) => p.id === platformId) ?? PLATFORMS[0];

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file, platform: platformId, about }),
      });
      const body = (await res.json().catch(() => null)) as (Prepared & { error?: string }) | null;
      if (!res.ok || !body?.url) throw new Error(body?.error ?? `Server returned ${res.status}`);
      setPrepared(body);
      setCaption(body.caption);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The video could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("The caption could not be copied. Select it and copy it by hand.");
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) dialog.current?.close();
      }}
      aria-labelledby="share-title"
      className="neon-edge m-auto w-[min(34rem,calc(100vw-2rem))] rounded-2xl border bg-panel p-0 text-white backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="space-y-5 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="share-title" className="text-lg font-semibold tracking-tight">
              Share this video
            </h2>
            <p className="mt-1 text-sm text-muted">
              Neonreel resizes it and writes a caption. You post it yourself on the upload page.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => dialog.current?.close()} aria-label="Close">
            Close
          </Button>
        </div>

        <div role="radiogroup" aria-label="Where to share" className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === platformId}
              disabled={busy}
              onClick={() => {
                setPlatformId(p.id);
                setPrepared(null);
              }}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors disabled:opacity-40 ${
                p.id === platformId
                  ? "border-accent bg-accent/10 text-white"
                  : "border-line text-muted hover:border-muted hover:text-white"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>

        {!prepared ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted">
              {platform.width} × {platform.height}, {platform.height > platform.width ? "vertical" : "wide"}. Nothing
              is cut off.
            </p>
            <Button variant="primary" disabled={busy} onClick={() => void prepare()}>
              {busy ? "Preparing…" : `Prepare for ${platform.name}`}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <video
              src={prepared.url}
              controls
              playsInline
              className="mx-auto max-h-64 rounded-lg bg-black"
              style={{ aspectRatio: `${platform.width} / ${platform.height}` }}
            />
            <div>
              <label htmlFor="share-caption" className="mb-1.5 block text-sm font-medium">
                Caption
              </label>
              <Textarea
                id="share-caption"
                rows={4}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
            </div>
            <ol className="flex flex-wrap items-center gap-2 text-sm">
              <li>
                <a
                  href={prepared.url}
                  download={`${name}-${platform.id}.mp4`}
                  className="inline-flex h-10 items-center rounded-lg border border-edge px-4 transition-colors hover:border-muted hover:bg-raised"
                >
                  1. Download video
                </a>
              </li>
              <li>
                <Button onClick={() => void copy()}>{copied ? "Copied" : "2. Copy caption"}</Button>
              </li>
              <li>
                <a
                  href={prepared.uploadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="neon-fill inline-flex h-10 items-center rounded-lg px-4 font-medium text-ink"
                >
                  3. Open {platform.name}
                </a>
              </li>
            </ol>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}
