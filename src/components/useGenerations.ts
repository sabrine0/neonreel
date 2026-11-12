// Neonreel - made by sabrine0 (https://github.com/sabrine0)
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Generation, GenerationList } from "@/lib/types";

const POLL_MS = 1500;

/** Loads the generation list and keeps polling while any job is running. */
export function useGenerations() {
  const [items, setItems] = useState<Generation[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Stars being saved. A list fetched before the save lands must not undo them. */
  const pendingStars = useRef(new Map<string, boolean>());

  const reload = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const res = await fetch("/api/generations", { cache: "no-store" });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = (await res.json()) as GenerationList;
      setItems(
        data.generations.map((g) =>
          pendingStars.current.has(g.id) ? { ...g, favorite: pendingStars.current.get(g.id) || undefined } : g,
        ),
      );
      setCredits(data.credits);
      setError(null);
      if (data.generations.some((g) => g.status === "running")) {
        timer.current = setTimeout(reload, POLL_MS);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load generations.");
      timer.current = setTimeout(reload, POLL_MS * 3);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reload]);

  const remove = useCallback(
    async (id: string) => {
      setItems((prev) => prev.filter((g) => g.id !== id));
      await fetch(`/api/generations/${id}`, { method: "DELETE" });
      void reload();
    },
    [reload],
  );

  const toggleFavorite = useCallback(
    async (id: string) => {
      const next = !items.find((g) => g.id === id)?.favorite;
      pendingStars.current.set(id, next);
      setItems((prev) => prev.map((g) => (g.id === id ? { ...g, favorite: next || undefined } : g)));
      try {
        await fetch(`/api/generations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ favorite: next }),
        });
      } finally {
        if (pendingStars.current.get(id) === next) pendingStars.current.delete(id);
      }
    },
    [items],
  );

  /** Runs a tool (upscale, remove background, smooth motion) on a finished result. */
  const applyTool = useCallback(
    async (sourceId: string, modelId: string) => {
      try {
        const res = await fetch("/api/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelId, sourceId }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Server returned ${res.status}`);
        }
        await reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "That tool could not be started.");
      }
    },
    [reload],
  );

  return { items, credits, loaded, error, reload, remove, toggleFavorite, applyTool };
}
