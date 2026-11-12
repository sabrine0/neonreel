// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-base text-muted">There is nothing at this address.</p>
      <Link
        to="/"
        className="neon-fill mt-6 inline-flex h-11 items-center rounded-lg px-6 text-sm font-semibold active:scale-[0.97]"
      >
        Back to the start
      </Link>
    </div>
  );
}
