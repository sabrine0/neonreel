// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { useEffect, useState } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

/**
 * Shared UI primitives. Every page builds from these so controls keep one
 * height (40px, 32px small), one radius (8px controls, 12px cards) and one
 * set of states. Colours come from the tokens in globals.css.
 */

const CONTROL =
  "w-full rounded-lg border border-edge bg-ink px-3 text-sm text-white " +
  "placeholder:text-faint transition-[border-color,box-shadow] hover:border-muted " +
  "focus:border-neon focus:shadow-[0_0_0_1px_var(--color-neon),0_0_20px_-6px_var(--color-neon)] " +
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-edge";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL} h-10 ${className}`} />;
}

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${CONTROL} resize-y py-2.5 leading-relaxed ${className}`} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${CONTROL} h-10 ${className}`} />;
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "neon-fill font-semibold",
  secondary: "border border-edge text-white hover:border-muted hover:bg-raised",
  ghost: "text-muted hover:bg-raised hover:text-white",
  danger: "text-danger hover:bg-danger/10",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  block?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  block = false,
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm " +
        "transition-[color,background-color,border-color,box-shadow,transform] duration-150 " +
        "active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 " +
        `${size === "md" ? "h-10 px-4" : "h-8 px-3"} ${block ? "w-full" : ""} ` +
        `${BUTTON_VARIANT[variant]} ${className}`
      }
    />
  );
}

/** Label, control and optional hint, with the label tied to the control. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-muted">{hint}</span>}
    </label>
  );
}

/** Like Field, for a group of controls (chips, a picker) rather than one input. */
export function Group({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label}>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      {children}
      {hint && <p className="mt-1.5 text-xs leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={`rounded-xl border border-line bg-panel ${className}`}>{children}</section>;
}

/** Small section heading inside a card. */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{children}</h2>;
}

interface SegmentedProps<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** Mutually exclusive choice shown as one pill-shaped bar. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className = "",
}: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className={`inline-flex rounded-lg bg-ink p-1 ${className}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`h-8 rounded-md px-4 text-sm transition-all duration-200 active:scale-[0.97] ${
            option.value === value
              ? "bg-raised font-medium text-white shadow-[inset_0_0_0_1px_var(--color-accent),0_0_18px_-6px_var(--color-accent)]"
              : "text-muted hover:text-white"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface ChipsProps<T extends string | number> {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  format?: (value: T) => string;
}

/** A short row of single-choice options. */
export function Chips<T extends string | number>({ options, value, onChange, format }: ChipsProps<T>) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
          className={`h-8 rounded-lg border px-3 text-sm tabular-nums transition-all duration-150 active:scale-[0.96] ${
            option === value
              ? "border-accent bg-accent/10 text-white shadow-[0_0_16px_-6px_var(--color-accent)]"
              : "border-edge text-muted hover:border-neon hover:text-white"
          }`}
        >
          {format ? format(option) : option}
        </button>
      ))}
    </div>
  );
}

type Tone = "neutral" | "accent" | "success" | "danger";

const BADGE_TONE: Record<Tone, string> = {
  neutral: "bg-raised text-muted",
  accent: "bg-accent/15 text-accent",
  success: "bg-success/15 text-success",
  danger: "bg-danger/15 text-danger",
};

interface BadgeProps {
  tone?: Tone;
  /** Shows a pulsing dot: the thing is happening right now. */
  live?: boolean;
  children: ReactNode;
}

export function Badge({ tone = "neutral", live = false, children }: BadgeProps) {
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium ${BADGE_TONE[tone]}`}
    >
      {live && <span aria-hidden className="live-dot" />}
      {children}
    </span>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const percent = Math.min(100, Math.max(3, Math.round(value * 100)));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1.5 overflow-hidden rounded-full bg-ink"
    >
      <div
        className="progress-live h-full rounded-full bg-gradient-to-r from-neon to-accent shadow-[0_0_12px_var(--color-accent)] transition-[width] duration-700 ease-out"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="animate-rise grid min-h-64 place-items-center rounded-xl border border-dashed border-line p-8 text-center">
      <div>
        <p className="font-medium">{title}</p>
        {children && <div className="mt-1 text-sm text-muted">{children}</div>}
      </div>
    </div>
  );
}

/** Delete button that asks once before acting: first click arms it, second confirms. */
export function ConfirmDelete({ onConfirm, label = "Delete" }: { onConfirm: () => void; label?: string }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <Button
      variant={armed ? "danger" : "ghost"}
      size="sm"
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      onBlur={() => setArmed(false)}
    >
      {armed ? "Click again to delete" : label}
    </Button>
  );
}
