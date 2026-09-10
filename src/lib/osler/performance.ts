export type PerformanceTier = "constrained" | "standard";

/**
 * Conservative client-side capability check. These values are deliberately
 * used only to postpone speculative work; interaction and feature access are
 * never withheld. Four-core / 2 GB Android tablets therefore stay responsive
 * while current phones and desktops retain the eager offline experience.
 */
export function getPerformanceTier(): PerformanceTier {
  if (typeof navigator === "undefined") return "standard";

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: {
      effectiveType?: string;
      saveData?: boolean;
    };
  };
  const connection = nav.connection;
  const constrainedNetwork =
    connection?.saveData === true ||
    connection?.effectiveType === "slow-2g" ||
    connection?.effectiveType === "2g";
  const constrainedHardware =
    (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 4) ||
    (nav.deviceMemory !== undefined && nav.deviceMemory <= 2);

  return constrainedNetwork || constrainedHardware ? "constrained" : "standard";
}

export function isConstrainedDevice(): boolean {
  return getPerformanceTier() === "constrained";
}

/** Keep CSS and View Transition fallbacks in sync with the warm-up policy. */
export function applyPerformanceTier(): void {
  if (typeof document === "undefined") return;
  if (isConstrainedDevice()) document.documentElement.setAttribute("data-perf", "low");
  else document.documentElement.removeAttribute("data-perf");
}
