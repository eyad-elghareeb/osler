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
  const openSettingsSection = (section: typeof settingsSection) => {
    setSettingsSection(section);
    setView("settings");
  };

  // Flag to check if we are currently handling a popstate update (to avoid pushState loops)
  const isPopStateRef = React.useRef(false);

  // Restore session
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) setUsername(stored);
  }, []);

  // Initialize from URL on mount & set up popstate listener
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
      if (urlSection) {
        setSettingsSection(urlSection as any);
      }
      if (urlArticle) setActiveArticleId(urlArticle);
      if (urlVideo) setActiveVideoId(urlVideo);

      if (urlPack) {
        try {
          const content = await loadContentByUid(urlPack);
          const mockNode: ContentTreeNode = {
            uid: urlPack,
            title: content.meta?.title || urlPack,
            type: content.type as any,
            path: "",
            items: [],
            lang: content.meta?.lang,
          };
          setActiveItem(mockNode);
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
          if (!activeItem || activeItem.uid !== urlPack) {
            const content = await loadContentByUid(urlPack);
            const mockNode: ContentTreeNode = {
              uid: urlPack,
              title: content.meta?.title || urlPack,
              type: content.type as any,
              path: "",
              items: [],
              lang: content.meta?.lang,
            };
            setActiveItem(mockNode);
            setActiveContent(content);
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

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  // Synchronize state changes to URL
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (isPopStateRef.current) return;

    const params = new URLSearchParams();
    if (view && view !== "dashboard") {
      params.set("view", view);
    }
    
    const packUid = activeItem?.uid || activeContent?.meta?.uid;
    if (packUid) {
      params.set("pack", packUid);
    }
    if (activeArticleId) {
      params.set("article", activeArticleId);
    }
    if (activeVideoId) {
      params.set("video", activeVideoId);
    }
    if (view === "settings" && settingsSection && settingsSection !== "language") {
      params.set("section", settingsSection);
    }

    const newSearch = params.toString() ? `?${params.toString()}` : "";
    const currentSearch = window.location.search;

    if (newSearch !== currentSearch) {
      const isMinorChange =
        (view === "settings" && currentSearch.includes("view=settings")) ||
        (view === "library" && currentSearch.includes("view=library") && !activeArticleId && !currentSearch.includes("article="));

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
