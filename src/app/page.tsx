"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { AppShell, type OslerView } from "@/components/osler/app-shell";
import { LoginScreen } from "@/components/osler/login-screen";
import { Dashboard } from "@/components/osler/dashboard";
import { Learn } from "@/components/osler/learn";
import { Library } from "@/components/osler/library";
import { QBankStudio } from "@/components/osler/qbank-studio";
import { FlashcardStudio } from "@/components/osler/flashcard-studio";
import { OsceStudio } from "@/components/osler/osce-studio";

const VideosStudio = dynamic(
  () => import("@/components/osler/videos-studio").then((m) => ({ default: m.VideosStudio })),
  { ssr: false },
);
import { Profile } from "@/components/osler/profile";
import { Settings } from "@/components/osler/settings";
import { loadContentByUid } from "@/lib/osler/content";
import type {
  AnyContent,
  ContentTreeNode,
} from "@/lib/osler/types";
import type { SearchResult } from "@/lib/osler/search";

const SESSION_KEY = "osler-session";

export default function Home() {
  const [username, setUsername] = React.useState<string | null>(null);
  const [view, setView] = React.useState<OslerView>("dashboard");
  const [activeItem, setActiveItem] = React.useState<ContentTreeNode | null>(null);
  const [activeContent, setActiveContent] = React.useState<AnyContent | null>(null);
  const [activeArticleId, setActiveArticleId] = React.useState<string | undefined>(undefined);
  const [activeVideoId, setActiveVideoId] = React.useState<string | undefined>(undefined);
  const [settingsSection, setSettingsSection] = React.useState<
    "language" | "ai" | "shortcuts" | "downloads" | "sync" | "backup" | "native" | "danger"
  >("language");
  // Navigation stack for the mobile back-swipe gesture. Each push records
  // the previous view so a swipe-back pops to it.
  const navStackRef = React.useRef<OslerView[]>([]);

  const openSettingsSection = (section: typeof settingsSection) => {
    setSettingsSection(section);
    setView("settings");
  };

  // Restore session
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) setUsername(stored);
  }, []);

  const handleLogin = (name: string) => {
    setUsername(name);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(SESSION_KEY, name);
    }
  };

  const handleLogout = () => {
    setUsername(null);
    setView("dashboard");
    setActiveItem(null);
    setActiveContent(null);
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(SESSION_KEY);
    }
  };

  const osceContent = React.useMemo(() => {
    if (!activeContent || activeContent.type !== "osce") return null;
    return activeContent;
  }, [activeContent]);

  const openPack = async (item: ContentTreeNode) => {
    try {
      const content = await loadContentByUid(item.uid);
      setActiveItem(item);
      setActiveContent(content);
      if (content.type === "osce") {
        setView("osce");
      } else {
        setView("qbank");
      }
    } catch (e) {
      console.error("Failed to load content pack:", e);
    }
  };

  const openPackWithData = (item: ContentTreeNode, content: AnyContent) => {
    setActiveItem(item);
    setActiveContent(content);
    if (content.type === "osce") {
      setView("osce");
    } else {
      setView("qbank");
    }
  };

  const openArticle = (id: string) => {
    setActiveArticleId(id);
    setView("library");
  };

  const handleExit = () => {
    setActiveItem(null);
    setActiveContent(null);
  };

  const handleExitQBank = () => {
    setActiveItem(null);
    setActiveContent(null);
    setView("qbank");
  };

  /**
   * Track the view stack so the mobile edge-swipe gesture can pop back to
   * the previous view. We don't track every state change — only meaningful
   * top-level view changes (not sub-mode switches inside a studio).
   */
  React.useEffect(() => {
    const stack = navStackRef.current;
    const top = stack[stack.length - 1];
    if (top === view) return;
    // If the new view is "dashboard", treat it as a reset (home).
    if (view === "dashboard") {
      navStackRef.current = [];
      return;
    }
    stack.push(view);
    // Cap the stack so it doesn't grow unbounded.
    if (stack.length > 20) stack.shift();
  }, [view]);

  const handleSwipeBack = React.useCallback(() => {
    const stack = navStackRef.current;
    if (stack.length <= 1) {
      setView("dashboard");
      return;
    }
    stack.pop(); // remove current
    const prev = stack[stack.length - 1] ?? "dashboard";
    setView(prev);
  }, []);

  /**
   * Dispatch a global-search result to the right navigation action.
   * The result kinds map cleanly to the existing handlers.
   */
  const handleSearchSelect = React.useCallback(async (r: SearchResult) => {
    switch (r.payload.type) {
      case "article":
        openArticle(r.payload.file);
        return;
      case "pack": {
        try {
          const content = await loadContentByUid(r.payload.uid);
          setActiveItem(null);
          setActiveContent(content);
          if (content.type === "osce") setView("osce");
          else if (content.type === "flashcard") setView("flashcards");
          else setView("qbank");
        } catch (e) {
          console.error("Search: failed to open pack", e);
        }
        return;
      }
      case "video":
        setActiveVideoId(r.payload.id);
        setView("videos");
        return;
      case "setting":
        setSettingsSection(r.payload.section as typeof settingsSection);
        setView("settings");
        return;
      case "nav":
        setView(r.payload.view as OslerView);
        return;
    }
  }, [settingsSection]);

  if (!username) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <AppShell
      view={view}
      onViewChange={setView}
      username={username}
      onLogout={handleLogout}
      onSearchSelect={handleSearchSelect}
      onSwipeBack={handleSwipeBack}
    >
      {view === "dashboard" ? (
        <Dashboard
          username={username}
          onViewChange={setView}
          onOpenPack={openPackWithData}
          onOpenArticle={openArticle}
        />
      ) : null}

      {view === "learn" ? <Learn onNavigate={setView} /> : null}

      {view === "library" ? (
        <Library initialArticleId={activeArticleId} />
      ) : null}

      {view === "qbank" ? (
        <QBankStudio
          activeItem={activeItem}
          activeContent={activeContent}
          onExit={handleExitQBank}
          onOpenPack={openPack}
        />
      ) : null}

      {view === "flashcards" ? (
        <FlashcardStudio
          activeItem={activeItem}
          activeContent={activeContent}
          onExit={handleExitQBank}
          onOpenPack={openPack}
          onNavigateHome={() => setView("dashboard")}
        />
      ) : null}

      {view === "osce" ? (
        <OsceStudio
          activeItem={activeItem}
          activeContent={osceContent}
          onExit={() => { handleExit(); setView("dashboard"); }}
          onOpenPack={openPack}
        />
      ) : null}

      {view === "videos" ? (
        <VideosStudio initialVideoId={activeVideoId} onOpenArticle={openArticle} />
      ) : null}

      {view === "profile" ? (
        <Profile
          username={username}
          onViewChange={setView}
          onOpenSettingsSection={openSettingsSection}
        />
      ) : null}

      {view === "settings" ? <Settings initialSection={settingsSection} /> : null}
    </AppShell>
  );
}
