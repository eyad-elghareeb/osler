"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Activity, ArrowRight } from "lucide-react";

interface LoginScreenProps {
  onLogin: (username: string) => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = username.trim() || "Guest";
    onLogin(name);
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-4 bg-background">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, type: "spring", stiffness: 200 }}
            className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground mx-auto mb-4 shadow-lg"
          >
            <Activity className="size-8" />
          </motion.div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome to Osler</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Medical study platform — quizzes, banks, flashcards, OSCE
          </p>
        </div>

        <form
          onSubmit={submit}
          className="bg-card border border-border rounded-xl p-6 space-y-4"
        >
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Your name"
              autoFocus
              className="mt-1.5 w-full h-10 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-primary transition-colors"
            />
          </div>

          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Any value (demo mode)"
              className="mt-1.5 w-full h-10 px-3 bg-background border border-border rounded-md text-sm outline-none focus:border-primary transition-colors"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Demo mode — no real authentication. All progress is stored
              locally.
            </p>
          </div>

          <button
            type="submit"
            className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            Sign In
            <ArrowRight className="size-4" />
          </button>

          <button
            type="button"
            onClick={() => onLogin("Guest")}
            className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Continue as Guest
          </button>
        </form>

        <p className="text-center text-[10px] text-muted-foreground mt-6">
          Osler v1 — Rebased on MedOS Lite UI/UX
        </p>
      </motion.div>
    </div>
  );
}
