// Neonreel - made by sabrine0 (https://github.com/sabrine0)
"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

interface Props {
  /** Short name of the setting, read by screen readers. */
  label: string;
  /** What the closed button shows: the current value. */
  value: ReactNode;
  /** Panel content. Call `close` after a choice that should dismiss the panel. */
  children: (close: () => void) => ReactNode;
  /** Panel width class; panels open upward from the prompt bar. */
  width?: string;
}

/** A compact setting button that opens a panel above itself. Closes on outside click or Escape. */
export function Popover({ label, value, children, width = "w-64" }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-sm transition-all duration-150 active:scale-[0.97] ${
          open
            ? "border-accent bg-accent/10 text-white shadow-[0_0_16px_-6px_var(--color-accent)]"
            : "border-line bg-ink/60 text-white hover:border-neon"
        }`}
      >
        {value}
        <span aria-hidden className={`text-xs text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={label}
          className={`animate-rise absolute bottom-full left-0 z-30 mb-2 max-h-[60vh] overflow-y-auto rounded-xl border border-line bg-panel p-2 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.9)] ${width}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** One selectable row inside a popover panel. */
export function PopoverOption({
  selected,
  disabled,
  onSelect,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
      className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        selected ? "bg-accent/15 text-white" : "hover:bg-raised"
      } disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent`}
    >
      {children}
    </button>
  );
}
