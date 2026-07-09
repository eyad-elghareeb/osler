"use client";

import * as React from "react";
import { AppShell, type OslerView } from "@/components/osler/app-shell";
import { LoginScreen } from "@/components/osler/login-screen";
import { Dashboard } from "@/components/osler/dashboard";
import { Library } from "@/components/osler/library";
import { QBankStudio } from "@/components/osler/qbank-studio";
import { FlashcardStudio } from "@/components/osler/flashcard-studio";
import { OsceStudio } from "@/components/osler/osce-studio";
import { AiAssistant } from "@/components/osler/ai-assistant";
import { Profile } from "@/components/osler/profile";
import { Settings } from "@/components/osler/settings";
import { loadContentByUid, nodeToItem } from "@/lib/osler/content";
import type {
  AnyContent,
  ContentTreeNode,
} from "@/lib/osler/types";

const SESSION_KEY = "osler-session";

export default function Home() {
  const [username, setUsername] = React.useState<string | null>(null);
  const [view, setView] = React.useState<OslerView>("dashboard");
  const [activeItem, setActiveItem] = React.useState<ContentTreeNode | null>(null);
  const [activeContent, setActiveContent] = React.useState<AnyContent | null>(null);
  const [activeArticleId, setActiveArticleId] = React.useState<string | undefined>(undefined);
  const [aiOpen, setAiOpen] = React.useState(false);

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

  if (!username) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <AppShell
      view={view}
      onViewChange={setView}
      username={username}
      onLogout={handleLogout}
      onArticleOpen={openArticle}
    >
      {view === "dashboard" ? (
        <Dashboard
          username={username}
          onViewChange={setView}
          onOpenPack={openPackWithData}
          onOpenArticle={openArticle}
        />
      ) : null}

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

      {view === "profile" ? <Profile username={username} onViewChange={setView} /> : null}

      {view === "settings" ? <Settings /> : null}
    </AppShell>
  );
}
