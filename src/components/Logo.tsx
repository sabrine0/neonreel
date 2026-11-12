/** The product name, in one place. */
export const BRAND = "Neonreel";

/**
 * The mark: a film reel drawn as an open neon ring with a play triangle at
 * its centre and a spark where the ring opens. Blue to pink, like the theme.
 */
export function LogoMark({ size = 30, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden
      className={`logo-glow ${className}`}
    >
      <defs>
        <linearGradient id="logo-neon" x1="3" y1="5" x2="29" y2="27" gradientUnits="userSpaceOnUse">
          <stop stopColor="#38d6ff" />
          <stop offset="1" stopColor="#ff4fd8" />
        </linearGradient>
      </defs>
      {/* Ring with a gap at the top (circumference 78.5: 62 drawn, 16.5 open). */}
      <circle
        cx="16"
        cy="16"
        r="12.5"
        fill="none"
        stroke="url(#logo-neon)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeDasharray="62 16.5"
        transform="rotate(-52 16 16)"
      />
      <circle cx="16" cy="3.5" r="1.7" fill="#ff8be6" />
      <path
        d="M13.2 10.6 21.8 16l-8.6 5.4Z"
        fill="url(#logo-neon)"
        stroke="url(#logo-neon)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Mark plus wordmark, for the header. */
export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark className="transition-transform duration-500 ease-out group-hover:rotate-[72deg]" />
      <span className="text-lg font-semibold tracking-tight">
        Neon<span className="neon-text">reel</span>
      </span>
    </span>
  );
}
