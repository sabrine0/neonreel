// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { useEffect, useRef, useState, type ReactNode } from "react";

type Phase = "plain" | "hidden" | "shown";

/**
 * Fades its content up into place the first time it scrolls into view.
 * Content starts visible and is only hidden once the script has confirmed it
 * sits below the fold, so nothing can stay invisible if the script is slow.
 */
export function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("plain");

  useEffect(() => {
    const node = ref.current;
    if (!node || node.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    setPhase("hidden");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setPhase("shown");
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const state = phase === "plain" ? "" : phase === "hidden" ? "reveal" : "reveal in";
  return (
    <div ref={ref} className={`${state} ${className}`}>
      {children}
    </div>
  );
}
