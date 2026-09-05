import {
  GraduationCap,
  Clock,
  FileText,
  CheckCircle2,
  BarChart2,
  Calculator,
  Sliders,
  MessageSquareWarning,
  Flag,
  Library,
  BookOpenText,
  Highlighter,
  Type,
  CloudDownload,
  Compass,
  Plus,
  type LucideIcon,
} from "lucide-react";
import type { StringKey } from "@/lib/osler/i18n";

export type TourId = "qbank" | "qbank-hub" | "qbank-session" | "library";

export interface WalkthroughStep {
  id: string;
  targetSelector: string;
  titleKey: StringKey;
  subtitleKey: StringKey;
  mainIcon: LucideIcon;
  preferredPlacement?: "top" | "bottom" | "left" | "right" | "auto";
  highlightPadding?: number;
  highlightRadius?: number;
  onEnterTab?: string;
}

export const QBANK_HUB_STEPS: WalkthroughStep[] = [
  {
    id: "qbank-hub-packs",
    targetSelector: "[data-walkthrough='qbank-packs']",
    titleKey: "walkthrough.qbankHub.step1.title",
    subtitleKey: "walkthrough.qbankHub.step1.subtitle",
    mainIcon: GraduationCap,
    preferredPlacement: "top",
    highlightPadding: 8,
    highlightRadius: 16,
  },
  {
    id: "qbank-hub-create",
    targetSelector: "[data-walkthrough='qbank-create-tab-btn']",
    titleKey: "walkthrough.qbankHub.step2.title",
    subtitleKey: "walkthrough.qbankHub.step2.subtitle",
    mainIcon: Plus,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
  },
  {
    id: "qbank-hub-tracker",
    targetSelector: "[data-walkthrough='qbank-tracker-tab-btn']",
    titleKey: "walkthrough.qbankHub.step3.title",
    subtitleKey: "walkthrough.qbankHub.step3.subtitle",
    mainIcon: BarChart2,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
  },
  {
    id: "qbank-hub-guide-btn",
    targetSelector: "[data-walkthrough='qbank-guide-btn']",
    titleKey: "walkthrough.qbankHub.step4.title",
    subtitleKey: "walkthrough.qbankHub.step4.subtitle",
    mainIcon: Compass,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 12,
  },
];

export const QBANK_SESSION_STEPS: WalkthroughStep[] = [
  {
    id: "qbank-session-bar",
    targetSelector: "[data-walkthrough='qbank-session-bar']",
    titleKey: "walkthrough.qbank.step1.title",
    subtitleKey: "walkthrough.qbank.step1.subtitle",
    mainIcon: Clock,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 12,
  },
  {
    id: "qbank-question-stem",
    targetSelector: "[data-walkthrough='qbank-question-stem']",
    titleKey: "walkthrough.qbank.step2.title",
    subtitleKey: "walkthrough.qbank.step2.subtitle",
    mainIcon: FileText,
    preferredPlacement: "bottom",
    highlightPadding: 8,
    highlightRadius: 14,
  },
  {
    id: "qbank-options",
    targetSelector: "[data-walkthrough='qbank-options']",
    titleKey: "walkthrough.qbank.step3.title",
    subtitleKey: "walkthrough.qbank.step3.subtitle",
    mainIcon: CheckCircle2,
    preferredPlacement: "top",
    highlightPadding: 8,
    highlightRadius: 14,
  },
  {
    id: "qbank-tools",
    targetSelector: "[data-walkthrough='qbank-tools']",
    titleKey: "walkthrough.qbank.step4.title",
    subtitleKey: "walkthrough.qbank.step4.subtitle",
    mainIcon: Calculator,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 12,
  },
  {
    id: "qbank-settings",
    targetSelector: "[data-walkthrough='qbank-settings']",
    titleKey: "walkthrough.qbank.step5.title",
    subtitleKey: "walkthrough.qbank.step5.subtitle",
    mainIcon: Sliders,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
  },
  {
    id: "qbank-reporting",
    targetSelector: "[data-walkthrough='qbank-reporting']",
    titleKey: "walkthrough.qbank.step6.title",
    subtitleKey: "walkthrough.qbank.step6.subtitle",
    mainIcon: MessageSquareWarning,
    preferredPlacement: "top",
    highlightPadding: 6,
    highlightRadius: 10,
  },
  {
    id: "qbank-navigator",
    targetSelector: "[data-walkthrough='qbank-navigator']",
    titleKey: "walkthrough.qbank.step7.title",
    subtitleKey: "walkthrough.qbank.step7.subtitle",
    mainIcon: Flag,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
  },
];

export const LIBRARY_STEPS: WalkthroughStep[] = [
  {
    id: "library-knowledge",
    targetSelector: "[data-walkthrough='library-tree']",
    titleKey: "walkthrough.library.step1.title",
    subtitleKey: "walkthrough.library.step1.subtitle",
    mainIcon: Library,
    preferredPlacement: "right",
    highlightPadding: 8,
    highlightRadius: 14,
  },
  {
    id: "library-toc",
    targetSelector: "[data-walkthrough='library-tabs']",
    titleKey: "walkthrough.library.step2.title",
    subtitleKey: "walkthrough.library.step2.subtitle",
    mainIcon: BookOpenText,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
  },
  {
    id: "library-tools",
    targetSelector: "[data-walkthrough='library-tools']",
    titleKey: "walkthrough.library.step3.title",
    subtitleKey: "walkthrough.library.step3.subtitle",
    mainIcon: Highlighter,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 12,
  },
  {
    id: "library-display",
    targetSelector: "[data-walkthrough='library-display']",
    titleKey: "walkthrough.library.step4.title",
    subtitleKey: "walkthrough.library.step4.subtitle",
    mainIcon: Type,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
  },
  {
    id: "library-reporting",
    targetSelector: "[data-walkthrough='library-reporting']",
    titleKey: "walkthrough.library.step5.title",
    subtitleKey: "walkthrough.library.step5.subtitle",
    mainIcon: MessageSquareWarning,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
  },
  {
    id: "library-offline-pdf",
    targetSelector: "[data-walkthrough='library-export']",
    titleKey: "walkthrough.library.step6.title",
    subtitleKey: "walkthrough.library.step6.subtitle",
    mainIcon: CloudDownload,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
  },
];

export function getTourSteps(tour: TourId): WalkthroughStep[] {
  if (tour === "qbank" || tour === "qbank-hub") return QBANK_HUB_STEPS;
  if (tour === "qbank-session") return QBANK_SESSION_STEPS;
  return LIBRARY_STEPS;
}

// Re-export for compatibility
export const QBANK_STEPS = QBANK_SESSION_STEPS;


