// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { MediaTile } from "./MediaTile";
import { Button, EmptyState } from "./ui";
import { useGenerations } from "./useGenerations";

interface Message {
  role: "user" | "assistant";
  content: string;
  /** Pictures and clips this reply started. */
  generationIds?: string[];
  /** Story this reply started. */
  storyId?: string;
}

const STARTERS = [
  "Make a picture of a fox reading in a library, anime style",
  "Make a 4-scene story about a robot who learns to paint",
  "Make a vertical picture of a neon city in the rain",
  "What can you do?",
];

/** A chat with the local language model, which can start pictures, clips and stories. */
export function Assistant({ ready }: { ready: boolean }) {
  const { items, reload, remove, toggleFavorite } = useGenerations();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, thinking]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || thinking) return;
    const next: Message[] = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    setThinking(true);
    setError(null);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content: c }) => ({ role, content: c })) }),
      });
      const body = (await res.json().catch(() => null)) as {
        reply?: string;
        generationIds?: string[];
        storyId?: string;
        error?: string;
      } | null;
      if (!res.ok || !body?.reply) throw new Error(body?.error ?? `Server returned ${res.status}`);
      setMessages([
        ...next,
        { role: "assistant", content: body.reply, generationIds: body.generationIds, storyId: body.storyId },
      ]);
      // Start polling for whatever was just queued.
      if (body.generationIds?.length) void reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant could not answer.");
    } finally {
      setThinking(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl pb-48">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Assistant</h1>
        <p className="mt-1 text-base text-muted">
          Say what you want in your own words. The assistant runs on this computer and starts the work for you.
        </p>
      </header>

      {!ready && (
        <p role="alert" className="mb-6 rounded-lg border border-line bg-panel p-4 text-sm text-muted">
          The assistant needs Ollama running on this computer. Start Ollama, then reload this page.
        </p>
      )}

      {messages.length === 0 ? (
        <EmptyState title="Ask for anything">
          <span className="mt-3 flex flex-wrap justify-center gap-2">
            {STARTERS.map((starter) => (
              <button
                key={starter}
                type="button"
                disabled={!ready}
                onClick={() => void send(starter)}
                className="rounded-full border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-white disabled:opacity-40"
              >
                {starter}
              </button>
            ))}
          </span>
        </EmptyState>
      ) : (
        <ol className="space-y-5" aria-live="polite">
          {messages.map((message, index) => (
            <li key={index} className={message.role === "user" ? "flex justify-end" : ""}>
              {message.role === "user" ? (
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-raised px-4 py-2.5 text-base">
                  {message.content}
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="whitespace-pre-wrap text-base leading-relaxed">{message.content}</p>
                  {message.generationIds && message.generationIds.length > 0 && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {message.generationIds.map((id) => {
                        const gen = items.find((g) => g.id === id);
                        return gen ? (
                          <MediaTile
                            key={id}
                            gen={gen}
                            onDelete={(target) => void remove(target)}
                            onFavorite={(target) => void toggleFavorite(target)}
                          />
                        ) : null;
                      })}
                    </div>
                  )}
                  {message.storyId && (
                    <Link
                      to="/story"
                      className="inline-flex h-10 items-center rounded-lg border border-edge px-4 text-sm transition-colors hover:border-muted hover:bg-raised"
                    >
                      Watch the story being made
                    </Link>
                  )}
                </div>
              )}
            </li>
          ))}
          {thinking && <li className="text-sm text-muted">Thinking…</li>}
        </ol>
      )}
      <div ref={end} />

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-ink via-ink/95 to-transparent px-4 pb-4 pt-16 sm:pb-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
          className="neon-edge pointer-events-auto mx-auto max-w-3xl rounded-2xl border p-3"
        >
          <div className="flex items-end gap-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={2}
              maxLength={4000}
              aria-label="Message"
              placeholder="Make a story about two friends who find a map…"
              className="min-h-14 w-full resize-none bg-transparent px-1 py-1 text-base leading-relaxed text-white outline-none placeholder:text-faint"
            />
            <Button type="submit" variant="primary" disabled={!ready || thinking || !draft.trim()}>
              {thinking ? "Thinking…" : "Send"}
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
