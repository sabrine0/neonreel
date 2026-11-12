// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { Link } from "react-router-dom";
import { MotionPlayer } from "@/components/MotionPlayer";
import { CAMERAS } from "@/lib/catalog";

export function PresetsPage() {
  return (
    <div>
      <header className="mb-8 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Camera presets</h1>
        <p className="mt-1 text-base text-muted">
          Each preset is a named camera move. Pick one to preview it on your own picture and use it
          for a clip.
        </p>
      </header>
      <div className="stagger grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {CAMERAS.map((cam) => (
          <Link
            key={cam.id}
            to={`/create?kind=video&camera=${cam.id}`}
            className="lift group overflow-hidden rounded-xl border border-line bg-panel hover:border-accent"
          >
            <MotionPlayer cameraId={cam.id} duration={3.5} />
            <div className="p-4">
              <p className="flex items-center justify-between gap-3 font-medium">
                {cam.name}
                <span className="text-sm font-normal text-muted transition-colors group-hover:text-accent">
                  Use
                </span>
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{cam.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
