"use client";

import * as React from "react";

type Theme = "dark" | "light";

interface OslerThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const OslerThemeContext = React.createContext<OslerThemeContextValue | null>(null);

export function OslerThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>("dark");

  React.useEffect(() => {
    const stored =
      (typeof window !== "undefined" &&
        (localStorage.getItem("osler-theme") as Theme | null)) ||
      "dark";
    setThemeState(stored);
    applyThemeClass(stored);
  }, []);

  const setTheme = React.useCallback((t: Theme) => {
    setThemeState(t);
    if (typeof window !== "undefined") {
      localStorage.setItem("osler-theme", t);
    }
    applyThemeClass(t);
  }, []);

  const toggleTheme = React.useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  const value = React.useMemo(
    () => ({ theme, toggleTheme, setTheme }),
    [theme, toggleTheme, setTheme]
  );

  return (
    <OslerThemeContext.Provider value={value}>
      {children}
    </OslerThemeContext.Provider>
  );
}

function applyThemeClass(t: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(t);
}

const DEFAULT_THEME_VALUE: OslerThemeContextValue = {
  theme: "dark" as Theme,
  toggleTheme: () => {},
  setTheme: () => {},
};

export function useOslerTheme() {
  const ctx = React.useContext(OslerThemeContext);
  return ctx ?? DEFAULT_THEME_VALUE;
}
