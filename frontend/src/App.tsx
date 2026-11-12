// Neonreel - made by sabrine0 (https://github.com/sabrine0)
import { useLayoutEffect } from "react";
import { Link, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { BRAND, Logo } from "@/components/Logo";
import { NavLinks } from "@/components/NavLinks";
import { AssistantPage } from "@/pages/AssistantPage";
import { CreatePage } from "@/pages/CreatePage";
import { HomePage } from "@/pages/HomePage";
import { LibraryPage } from "@/pages/LibraryPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { PresetsPage } from "@/pages/PresetsPage";
import { StoryPage } from "@/pages/StoryPage";
import { VoicePage } from "@/pages/VoicePage";

export function App() {
  const { pathname } = useLocation();
  const navigation = useNavigationType();

  // A new page starts at the top; going back keeps the position the browser restores.
  useLayoutEffect(() => {
    if (navigation !== "POP") window.scrollTo(0, 0);
  }, [pathname, navigation]);

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line bg-ink/90 backdrop-blur">
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-4 sm:px-6">
          <Link to="/" aria-label={`${BRAND} home`} className="group shrink-0">
            <Logo />
          </Link>
          <NavLinks />
        </nav>
        <div aria-hidden className="neon-line absolute inset-x-0 -bottom-px h-px" />
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        {/*
         * Re-mounted on every navigation, so each page fades in. Opacity only: a
         * transform here would become the containing block for `position: fixed`
         * children and un-dock the prompt bar on the Create page.
         */}
        <div key={pathname} className="animate-fade">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/assistant" element={<AssistantPage />} />
            <Route path="/story" element={<StoryPage />} />
            <Route path="/create" element={<CreatePage />} />
            <Route path="/voice" element={<VoicePage />} />
            <Route path="/presets" element={<PresetsPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </div>
      </main>
    </>
  );
}
