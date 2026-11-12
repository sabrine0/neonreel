// Neonreel - made by sabrine0 (https://github.com/sabrine0)
"use client";

import { useEffect, useRef } from "react";
import { getCamera, getModel } from "@/lib/catalog";
import type { Generation } from "@/lib/types";

interface Props {
  /** The finished results that can be stepped through. */
  items: Generation[];
  /** Id of the one being shown. */
  openId: string;
  onChange: (id: string) => void;
  onClose: () => void;
}

/** Full-screen viewer. Left and Right step through results, Escape closes. */
export function Lightbox({ items, openId, onChange, onClose }: Props) {
  const index = items.findIndex((item) => item.id === openId);
  const gen = items[index];
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight" && index < items.length - 1) onChange(items[index + 1].id);
      if (event.key === "ArrowLeft" && index > 0) onChange(items[index - 1].id);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [index, items, onChange, onClose]);

  if (!gen?.outputUrl) return null;

  const model = getModel(gen.modelId);
  const details = [
    model?.name ?? gen.modelId,
    gen.aspect,
    ...(gen.kind === "video" ? [`${gen.duration} seconds`, getCamera(gen.cameraId).name] : []),
    new Date(gen.createdAt).toLocaleString(),
  ];
  const step =
    "grid size-11 shrink-0 place-items-center rounded-full border border-line bg-panel/80 text-xl backdrop-blur transition-all duration-150 hover:border-neon hover:text-neon active:scale-95 disabled:pointer-events-none disabled:opacity-30";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Viewer"
      className="animate-fade fixed inset-0 z-50 flex flex-col bg-ink/95 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <p className="text-sm tabular-nums text-muted">
          {index + 1} of {items.length}
        </p>
        <div className="flex items-center gap-2">
          <a
            href={gen.outputUrl}
            download={`neonreel-${gen.id.slice(0, 8)}.${gen.kind === "video" ? "mp4" : "png"}`}
            className="inline-flex h-9 items-center rounded-lg border border-edge px-3 text-sm transition-colors hover:border-neon"
          >
            Download
          </a>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-lg border border-edge px-3 text-sm transition-colors hover:border-neon"
          >
            Close
          </button>
        </div>
      </div>

      <div
        className="flex min-h-0 flex-1 items-center gap-3 px-3 sm:px-6"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <button
          type="button"
          aria-label="Previous"
          disabled={index <= 0}
          onClick={() => onChange(items[index - 1].id)}
          className={step}
        >
          ‹
        </button>
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center self-stretch">
          {gen.outputType === "video" ? (
            <video
              key={gen.id}
              src={gen.outputUrl}
              controls
              autoPlay
              loop
              playsInline
              className="animate-rise max-h-full max-w-full rounded-xl border border-line bg-black"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={gen.id}
              src={gen.outputUrl}
              alt={gen.prompt}
              className="animate-rise max-h-full max-w-full rounded-xl border border-line object-contain"
            />
          )}
        </div>
        <button
          type="button"
          aria-label="Next"
          disabled={index >= items.length - 1}
          onClick={() => onChange(items[index + 1].id)}
          className={step}
        >
          ›
        </button>
      </div>

      <div className="mx-auto w-full max-w-3xl px-4 py-4 text-center sm:px-6">
        <p className="line-clamp-3 text-sm">{gen.prompt || "No prompt, reference picture only"}</p>
        <p className="mt-1 text-xs text-muted">{details.join(" · ")}</p>
      </div>
    </div>
  );
}
