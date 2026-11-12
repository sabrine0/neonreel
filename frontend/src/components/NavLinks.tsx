// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { Link, useLocation } from "react-router-dom";

const LINKS = [
  { href: "/assistant", label: "Assistant" },
  { href: "/story", label: "Story" },
  { href: "/create", label: "Create" },
  { href: "/voice", label: "Voice" },
  { href: "/presets", label: "Camera presets" },
  { href: "/library", label: "Library" },
];

export function NavLinks() {
  const { pathname } = useLocation();
  return (
    <div className="flex items-center gap-1 overflow-x-auto text-sm">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            to={link.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-9 items-center whitespace-nowrap rounded-lg px-3 transition-all duration-200 active:scale-[0.97] ${
              active
                ? "bg-raised font-medium text-white shadow-[inset_0_-2px_0_var(--color-accent),0_8px_20px_-12px_var(--color-accent)]"
                : "text-muted hover:bg-raised hover:text-white"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
