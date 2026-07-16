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

/** Views that carry a content-pack param in the URL. */
const PACK_VIEWS: ReadonlySet<OslerView> = new Set(["qbank", "flashcards", "osce"]);

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
  const openSettingsSection = (section: typeof settingsSection) => {
    setSettingsSection(section);
    setView("settings");
  };

  const isPopStateRef = React.useRef(false);
  /** Refs so the popstate handler always reads fresh values. */
  const activeItemRef = React.useRef(activeItem);
  const activeContentRef = React.useRef(activeContent);
  const activeArticleIdRef = React.useRef(activeArticleId);
  const activeVideoIdRef = React.useRef(activeVideoId);
  const viewRef = React.useRef(view);
  React.useEffect(() => { activeItemRef.current = activeItem; }, [activeItem]);
  React.useEffect(() => { activeContentRef.current = activeContent; }, [activeContent]);
  React.useEffect(() => { activeArticleIdRef.current = activeArticleId; }, [activeArticleId]);
  React.useEffect(() => { activeVideoIdRef.current = activeVideoId; }, [activeVideoId]);
  React.useEffect(() => { viewRef.current = view; }, [view]);

  // Restore session
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) setUsername(stored);
  }, []);

  // Build a ContentTreeNode from a loaded pack
  function nodeFromPack(uid: string, content: AnyContent): ContentTreeNode {
    return {
      uid,
      title: content.meta?.title || uid,
      type: content.type as any,
      path: "",
      items: [],
      lang: content.meta?.lang,
    };
  }

  // Initialize from URL on mount & set up popstate + pageshow listeners
  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const initFromUrl = async () => {
      const params = new URLSearchParams(window.location.search);
      const urlView = params.get("view") as OslerView | null;
      const urlPack = params.get("pack");
      const urlArticle = params.get("article");
      const urlVideo = params.get("video");
      const urlSection = params.get("section");

      if (urlView) setView(urlView);
      if (urlSection) setSettingsSection(urlSection as any);
      if (urlArticle) setActiveArticleId(urlArticle);
      if (urlVideo) setActiveVideoId(urlVideo);

      if (urlPack) {
        try {
          const content = await loadContentByUid(urlPack);
          setActiveItem(nodeFromPack(urlPack, content));
          setActiveContent(content);

          if (!urlView) {
            if (content.type === "osce") setView("osce");
            else if (content.type === "flashcard") setView("flashcards");
            else setView("qbank");
          }
        } catch (e) {
          console.error("Failed to load content pack from URL:", e);
        }
      }
    };

    initFromUrl();

    const handlePopState = async () => {
      isPopStateRef.current = true;
      try {
        const params = new URLSearchParams(window.location.search);
        const urlView = (params.get("view") as OslerView) || "dashboard";
        const urlPack = params.get("pack");
        const urlArticle = params.get("article") || undefined;
        const urlVideo = params.get("video") || undefined;
        const urlSection = params.get("section") as any;

        setView(urlView);
        if (urlSection) setSettingsSection(urlSection);
        setActiveArticleId(urlArticle);
        setActiveVideoId(urlVideo);

        if (urlPack) {
          if (!activeItemRef.current || activeItemRef.current.uid !== urlPack) {
            try {
              const content = await loadContentByUid(urlPack);
              setActiveItem(nodeFromPack(urlPack, content));
              setActiveContent(content);
            } catch (e) {
              console.error("Failed to load content pack from URL:", e);
            }
          }
        } else {
          setActiveItem(null);
          setActiveContent(null);
        }
      } catch (e) {
        console.error("Failed to handle popstate:", e);
      } finally {
        isPopStateRef.current = false;
      }
    };

    // On bfcache restore (screen wake on mobile), re-sync URL → state.
    const handlePageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      // bfcache restored — the URL may have changed while frozen.
      // Re-read the URL and apply it the same way as a popstate.
      handlePopState();
    };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  // Synchronize state changes to URL — only include params relevant to the current view.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (isPopStateRef.current) return;

    const params = new URLSearchParams();
    if (view !== "dashboard") {
      params.set("view", view);
    }
    if (view === "settings" && settingsSection !== "language") {
      params.set("section", settingsSection);
    }
    if (PACK_VIEWS.has(view)) {
      const packUid = activeItem?.uid || activeContent?.meta?.uid;
      if (packUid) params.set("pack", packUid);
    }
    if (view === "library" && activeArticleId) {
      params.set("article", activeArticleId);
    }
    if (view === "videos" && activeVideoId) {
      params.set("video", activeVideoId);
    }

    const newSearch = params.toString() ? `?${params.toString()}` : "";
    const currentSearch = window.location.search;

    if (newSearch !== currentSearch) {
      // Use replaceState when the change is non-navigational (same-view
      // param tweak) or the initial load — avoids polluting the history
      // stack with intermediate states.
      const prevView = viewRef.current;
      const sameView = prevView === view;
      const isMinorChange = sameView || (view === "settings" && currentSearch.includes("view=settings"));

      if (isMinorChange) {
        window.history.replaceState(null, "", window.location.pathname + newSearch);
      } else {
        window.history.pushState(null, "", window.location.pathname + newSearch);
      }
    }
  }, [view, activeItem, activeContent, activeArticleId, activeVideoId, settingsSection]);

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
        <Library initialArticleId={activeArticleId} onNavigateBack={() => setView("learn")} />
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
          onNavigateBack={() => setView("learn")}
        />
      ) : null}

      {view === "osce" ? (
        <OsceStudio
          activeItem={activeItem}
          activeContent={osceContent}
          onExit={() => { handleExit(); setView("dashboard"); }}
          onOpenPack={openPack}
          onNavigateBack={() => setView("learn")}
        />
      ) : null}

      {view === "videos" ? (
        <VideosStudio initialVideoId={activeVideoId} onOpenArticle={openArticle} onNavigateBack={() => setView("learn")} />
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
