"use client";

import * as React from "react";

export type Platform = "ios" | "android" | "macos" | "windows" | "linux" | "web";
export type FormFactor = "phone" | "tablet" | "desktop";

export interface PlatformInfo {
  isTauri: boolean;
  platform: Platform;
  formFactor: FormFactor;
  isMobile: boolean;
  isPhone: boolean;
  isDesktop: boolean;
  isTouch: boolean;
}

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "web";
  const ua = navigator.userAgent || "";
  const isIpad =
    /Macintosh/i.test(ua) &&
    typeof document !== "undefined" &&
    "ontouchend" in document &&
    (navigator.maxTouchPoints || 0) > 1;
  if (/iPhone|iPad|iPod/i.test(ua) || isIpad) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macos";
  if (/Windows/i.test(ua)) return "windows";
  if (/Linux/i.test(ua)) return "linux";
  return "web";
}

function detectFormFactor(platform: Platform): FormFactor {
  if (typeof window === "undefined") return "desktop";
  if (platform === "ios" || platform === "android") {
    const minDim = Math.min(window.innerWidth, window.innerHeight);
    return minDim < 600 ? "phone" : "tablet";
  }
  const w = window.innerWidth;
  if (w < 768) return "phone";
  if (w < 1024) return "tablet";
  return "desktop";
}

function detectIsTauri(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (window as any).__TAURI_INTERNALS__ !== undefined ||
    (window as any).__TAURI__ !== undefined
  );
}

function detectIsTouch(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "ontouchstart" in window ||
    (navigator.maxTouchPoints || 0) > 0
  );
}

function buildInfo(): PlatformInfo {
  const platform = detectPlatform();
  const formFactor = detectFormFactor(platform);
  const isTauri = detectIsTauri();
  const isTouch = detectIsTouch();
  const isMobile = formFactor === "phone" || formFactor === "tablet";
  return {
    isTauri,
    platform,
    formFactor,
    isMobile,
    isPhone: formFactor === "phone",
    isDesktop: formFactor === "desktop",
    isTouch,
  };
}

const SSR_DEFAULT: PlatformInfo = {
  isTauri: false,
  platform: "web",
  formFactor: "desktop",
  isMobile: false,
  isPhone: false,
  isDesktop: true,
  isTouch: false,
};

export function usePlatform(): PlatformInfo {
  const [info, setInfo] = React.useState<PlatformInfo>(
    typeof window === "undefined" ? SSR_DEFAULT : buildInfo
  );

  React.useEffect(() => {
    setInfo(buildInfo());
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setInfo(buildInfo()));
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  return info;
}

export function getPlatformSync(): PlatformInfo {
  if (typeof window === "undefined") return SSR_DEFAULT;
  return buildInfo();
}
