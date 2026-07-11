"use client";

import * as React from "react";

const BLUR_KEY = "osler_disable_blur";

function readSetting(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(BLUR_KEY) === "true";
}

function applyHtmlAttr(value: boolean) {
  document.documentElement.toggleAttribute("data-disable-blur", value);
}

export function useDisableBlur() {
  const [disabled, setDisabled] = React.useState(false);

  React.useEffect(() => {
    setDisabled(readSetting());

    const handler = () => setDisabled(readSetting());
    window.addEventListener("osler-blur-changed", handler);
    return () => window.removeEventListener("osler-blur-changed", handler);
  }, []);

  const toggle = React.useCallback((value: boolean) => {
    localStorage.setItem(BLUR_KEY, String(value));
    applyHtmlAttr(value);
    window.dispatchEvent(new CustomEvent("osler-blur-changed"));
  }, []);

  return { disabled, toggle };
}
