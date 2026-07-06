"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Sun,
  Moon,
  Trash2,
  Info,
  Github,
  Keyboard,
  RefreshCw,
} from "lucide-react";
import { useOslerTheme } from "./theme-provider";
import { storage } from "@/lib/osler/storage";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const SHORTCUTS = [
  { keys: "Ctrl + K", desc: "Open search" },
  { keys: "Esc", desc: "Close search / dialogs" },
  { keys: "← / →", desc: "Previous / next question (in engine)" },
  { keys: "Space", desc: "Flip flashcard" },
  { keys: "Enter", desc: "Submit answer / send chat" },
];

export function Settings() {
  const { theme, setTheme } = useOslerTheme();
  const [progressCount, setProgressCount] = React.useState(0);

  React.useEffect(() => {
    const update = () => setProgressCount(storage.allProgress().length);
    update();
    return storage.subscribe(update);
  }, []);

  const clearProgress = () => {
    if (
      typeof window !== "undefined" &&
      window.confirm("Clear ALL study progress? This cannot be undone.")
    ) {
      storage.clearAll();
    }
  };

  return (
    <div className="h-full overflow-y-auto osler-scroll">
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-8"
        >
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-1">
            Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Customize your Osler experience.
          </p>
        </motion.div>

        {/* Theme */}
        <Section
          title="Appearance"
          icon={Sun}
          description="Choose how Osler looks to you."
        >
          <div className="grid grid-cols-2 gap-3">
            <ThemeOption
              label="Dark"
              description="Navy + blue (default)"
              icon={Moon}
              active={theme === "dark"}
              onClick={() => setTheme("dark")}
            />
            <ThemeOption
              label="Light"
              description="Cream + navy"
              icon={Sun}
              active={theme === "light"}
              onClick={() => setTheme("light")}
            />
          </div>
        </Section>

        {/* Data */}
        <Section
          title="Data & Progress"
          icon={RefreshCw}
          description="Your study data is stored locally in this browser. Clearing your browser cache will also clear this data."
        >
          <div className="bg-card border border-border rounded-lg p-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">
                {progressCount} pack{progressCount !== 1 ? "s" : ""} with
                progress
              </div>
              <div className="text-xs text-muted-foreground">
                Includes quiz, bank, flashcard, written, and OSCE answers.
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={clearProgress}
              disabled={progressCount === 0}
              className="border-red-500/30 text-red-500 hover:bg-red-500/10"
            >
              <Trash2 className="size-3.5 mr-1" />
              Clear
            </Button>
          </div>
        </Section>

        {/* Keyboard shortcuts */}
        <Section
          title="Keyboard Shortcuts"
          icon={Keyboard}
          description="Speed up your workflow with these shortcuts."
        >
          <div className="bg-card border border-border rounded-lg divide-y divide-border">
            {SHORTCUTS.map((s) => (
              <div
                key={s.keys}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="text-sm">{s.desc}</span>
                <kbd className="text-[10px] px-2 py-1 rounded border border-border bg-muted text-muted-foreground font-mono">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        </Section>

        {/* About */}
        <Section
          title="About"
          icon={Info}
          description="Osler is an open medical study platform."
        >
          <div className="bg-card border border-border rounded-lg p-4 space-y-2">
            <Row label="Version" value="1.0.0-rebased" />
            <Row label="UI/UX" value="MedOS Lite" />
            <Row label="Framework" value="Next.js 16 + React 19" />
            <Row label="Storage" value="localStorage (client-side)" />
            <Row label="Engines" value="Quiz · Bank · Flashcard · Written · OSCE" />
            <div className="pt-2">
              <Badge variant="secondary" className="text-[10px]">
                <Github className="size-3 mr-1" />
                Open source
              </Badge>
            </div>
          </div>
        </Section>

        <p className="text-center text-[10px] text-muted-foreground mt-8 pb-4">
          Osler — Rebased on MedOS Lite UI/UX · Built with Next.js
        </p>
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  description,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mb-6"
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold uppercase tracking-wider">
          {title}
        </h2>
      </div>
      {description ? (
        <p className="text-xs text-muted-foreground mb-3">{description}</p>
      ) : null}
      {children}
    </motion.section>
  );
}

function ThemeOption({
  label,
  description,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left p-4 rounded-lg border transition-all",
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border bg-card hover:border-foreground/30"
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <Icon className="size-4 text-muted-foreground" />
        {active ? (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-primary">
            Active
          </span>
        ) : null}
      </div>
      <div className="text-sm font-semibold">{label}</div>
      <div className="text-[11px] text-muted-foreground">{description}</div>
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
