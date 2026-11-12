// Neonreel - made by sabrine0 (https://github.com/sabrine0)
/**
 * Re-mounted on every navigation, so each page fades in. Opacity only: a
 * transform here would become the containing block for `position: fixed`
 * children and un-dock the prompt bar on the Create page.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade">{children}</div>;
}
