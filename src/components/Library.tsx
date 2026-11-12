// Neonreel - made by sabrine0 (https://github.com/sabrine0)
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Lightbox } from "./Lightbox";
import { MediaTile } from "./MediaTile";
import { EmptyState, Input, Segmented } from "./ui";
import { useGenerations } from "./useGenerations";

type Filter = "all" | "image" | "video" | "favorite";

export function Library() {
  const { items, loaded, error, remove, toggleFavorite, applyTool } = useGenerations();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((gen) => {
      if (filter === "favorite" ? !gen.favorite : filter !== "all" && gen.kind !== filter) return false;
      const prompt = gen.prompt.toLowerCase();
      return words.every((word) => prompt.includes(word));
    });
  }, [items, filter, search]);

  /** What the viewer can step through: finished pictures and clips, in the order shown. */
  const viewable = shown.filter((gen) => gen.status === "done" && gen.outputUrl && gen.outputType !== "motion");
  const count = (test: Filter) =>
    items.filter((gen) => (test === "favorite" ? gen.favorite : gen.kind === test)).length;

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
          <p className="mt-1 text-base text-muted">
            Every image and clip you have made, including the scenes of your stories.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-56">
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prompts"
              aria-label="Search prompts"
            />
          </div>
          <Segmented<Filter>
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: `All (${items.length})` },
              { value: "image", label: `Images (${count("image")})` },
              { value: "video", label: `Videos (${count("video")})` },
              { value: "favorite", label: `Favourites (${count("favorite")})` },
            ]}
          />
        </div>
      </header>

      {error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {error}
        </p>
      )}

      {loaded && shown.length === 0 ? (
        items.length === 0 ? (
          <EmptyState title="Nothing here yet">
            <Link href="/create" className="text-accent underline-offset-4 hover:underline">
              Create an image or a clip
            </Link>
          </EmptyState>
        ) : (
          <EmptyState title="Nothing matches">
            {filter === "favorite" && !search
              ? "Press the star on a picture or clip to keep it here."
              : "Try a different search or filter."}
          </EmptyState>
        )
      ) : (
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
          {shown.map((gen) => (
            <MediaTile
              key={gen.id}
              gen={gen}
              onDelete={(id) => void remove(id)}
              onFavorite={(id) => void toggleFavorite(id)}
              onOpen={setOpenId}
              onTool={(id, modelId) => void applyTool(id, modelId)}
            />
          ))}
        </div>
      )}

      {openId && (
        <Lightbox items={viewable} openId={openId} onChange={setOpenId} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}
