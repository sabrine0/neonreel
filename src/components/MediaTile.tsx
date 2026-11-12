"use client";

import { MODELS, getCamera, getModel } from "@/lib/catalog";
import type { Generation } from "@/lib/types";
import { MotionPlayer } from "./MotionPlayer";
import { ConfirmDelete, ProgressBar } from "./ui";

interface Props {
  gen: Generation;
  onDelete: (id: string) => void;
  /** Loads this result's prompt and settings back into the prompt bar. */
  onReuse?: (gen: Generation) => void;
  /** Uses this picture as the starting frame of a new video. */
  onAnimate?: (gen: Generation) => void;
  /** Uses this picture as the one to change with an edit instruction. */
  onEdit?: (gen: Generation) => void;
  /** Stars or unstars this result. */
  onFavorite?: (id: string) => void;
  /** Opens this result in the full-screen viewer. */
  onOpen?: (id: string) => void;
  /** Runs a tool model (upscale, remove background, smooth motion) on this result. */
  onTool?: (id: string, modelId: string) => void;
}

/** Tools that work on a finished result, by the kind of result they accept. */
const TOOLS = MODELS.filter((model) => model.tool);

const ACTION =
  "inline-flex h-8 items-center rounded-lg px-3 text-sm transition-colors";

/**
 * One result in a gallery: the picture or clip fills the tile, and its prompt
 * and actions appear over it on hover or keyboard focus.
 */
export function MediaTile({
  gen,
  onDelete,
  onReuse,
  onAnimate,
  onEdit,
  onFavorite,
  onOpen,
  onTool,
}: Props) {
  const model = getModel(gen.modelId);
  const ratio = gen.aspect.replace(":", " / ");
  const details = [
    model?.name ?? gen.modelId,
    ...(gen.kind === "video" ? [`${gen.duration}s`, getCamera(gen.cameraId).name] : []),
  ].join(" · ");
  const done = gen.status === "done" && Boolean(gen.outputUrl);

  return (
    <article className="animate-rise group relative mb-4 break-inside-avoid overflow-hidden rounded-xl border border-line bg-panel transition-colors duration-200 focus-within:border-edge hover:border-edge">
      {done && gen.kind === "image" && onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(gen.id)}
          aria-label="View full screen"
          className="block w-full cursor-zoom-in"
        >
          <Media gen={gen} ratio={ratio} />
        </button>
      ) : (
        <Media gen={gen} ratio={ratio} />
      )}

      {done && onFavorite && (
        <button
          type="button"
          onClick={() => onFavorite(gen.id)}
          aria-pressed={Boolean(gen.favorite)}
          aria-label={gen.favorite ? "Remove from favourites" : "Add to favourites"}
          title={gen.favorite ? "Remove from favourites" : "Add to favourites"}
          className={`absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-black/60 text-lg backdrop-blur transition-all duration-200 hover:scale-110 active:scale-95 ${
            gen.favorite
              ? "text-accent shadow-[0_0_14px_-2px_var(--color-accent)]"
              : "text-white/80 opacity-0 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
          }`}
        >
          {gen.favorite ? "★" : "☆"}
        </button>
      )}

      {done && gen.kind === "video" && (
        <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/70 px-2 py-1 text-xs font-medium backdrop-blur">
          Video
        </span>
      )}

      {/* Videos keep their own controls reachable, so their panel sits below instead of on top. */}
      <div
        className={
          done && gen.kind === "image"
            ? "absolute inset-x-0 bottom-0 translate-y-2 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-4 pt-12 opacity-0 transition-all duration-200 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100"
            : "p-4"
        }
      >
        <p className="line-clamp-2 text-sm" title={gen.prompt}>
          {gen.prompt || <span className="text-muted">No prompt, reference picture only</span>}
        </p>
        <p className="mt-1 text-xs text-muted">{details}</p>
        <div className="mt-3 flex flex-wrap items-center gap-1">
          {onReuse && (
            <button
              type="button"
              onClick={() => onReuse(gen)}
              title="Load this prompt and its settings back into the prompt bar"
              className={`${ACTION} bg-white/10 backdrop-blur hover:bg-white/20`}
            >
              Reuse
            </button>
          )}
          {done && gen.kind === "image" && onAnimate && (
            <button
              type="button"
              onClick={() => onAnimate(gen)}
              title="Make a video that starts from this picture"
              className={`${ACTION} bg-white/10 backdrop-blur hover:bg-white/20`}
            >
              Animate
            </button>
          )}
          {done && gen.kind === "image" && onEdit && (
            <button
              type="button"
              onClick={() => onEdit(gen)}
              title="Change this picture with a text instruction"
              className={`${ACTION} bg-white/10 backdrop-blur hover:bg-white/20`}
            >
              Edit
            </button>
          )}
          {done &&
            gen.outputType !== "motion" &&
            onTool &&
            TOOLS.filter(
              (tool) => tool.kind === gen.kind && (tool.tool?.repeatable || tool.id !== gen.modelId),
            ).map((tool) => (
              <button
                key={tool.id}
                type="button"
                onClick={() => onTool(gen.id, tool.id)}
                title={tool.tool?.about}
                className={`${ACTION} bg-white/10 backdrop-blur hover:bg-white/20`}
              >
                {tool.tool?.label}
              </button>
            ))}
          {done && gen.kind === "video" && gen.outputType !== "motion" && onOpen && (
            <button
              type="button"
              onClick={() => onOpen(gen.id)}
              className={`${ACTION} bg-white/10 backdrop-blur hover:bg-white/20`}
            >
              View
            </button>
          )}
          {done && gen.outputType !== "motion" && (
            <a
              href={gen.outputUrl}
              download={`neonreel-${gen.id.slice(0, 8)}.${gen.kind === "video" ? "mp4" : "png"}`}
              className={`${ACTION} text-muted hover:bg-white/10 hover:text-white`}
            >
              Download
            </a>
          )}
          <span className="ml-auto">
            <ConfirmDelete onConfirm={() => onDelete(gen.id)} />
          </span>
        </div>
      </div>
    </article>
  );
}

function Media({ gen, ratio }: { gen: Generation; ratio: string }) {
  if (gen.status === "running") {
    return (
      <div className="shimmer grid place-items-center" style={{ aspectRatio: ratio }}>
        <div className="w-2/3 max-w-56 space-y-2 text-center text-sm text-muted">
          <p>Creating {gen.kind}…</p>
          <ProgressBar value={gen.progress} />
        </div>
      </div>
    );
  }

  if (gen.status === "failed" || !gen.outputUrl) {
    return (
      <div role="alert" className="grid place-items-center bg-danger/10 p-6" style={{ aspectRatio: ratio }}>
        <p className="text-center text-sm text-danger">
          This one failed. Credits were refunded.
          {gen.error && <span className="mt-1 block text-xs opacity-80">{gen.error}</span>}
        </p>
      </div>
    );
  }

  if (gen.outputType === "video") {
    return (
      <video
        src={gen.outputUrl}
        controls
        loop
        muted
        playsInline
        preload="metadata"
        className="block w-full bg-black"
        style={{ aspectRatio: ratio }}
      />
    );
  }

  if (gen.outputType === "motion") {
    return (
      <MotionPlayer src={gen.outputUrl} cameraId={gen.cameraId} aspect={gen.aspect} duration={gen.duration} />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={gen.outputUrl}
      alt={gen.prompt}
      loading="lazy"
      className="block w-full bg-black object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
      style={{ aspectRatio: ratio }}
    />
  );
}
