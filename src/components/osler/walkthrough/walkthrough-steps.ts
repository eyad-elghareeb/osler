import {
  GraduationCap,
  Clock,
  FileText,
  CheckCircle2,
  BarChart2,
  Sliders,
  MessageSquareWarning,
  Flag,
  Library,
  BookOpenText,
  Highlighter,
  Type,
  CloudDownload,
  Bookmark,
  BookmarkCheck,
  Plus,
  Sparkles,
  Layers,
  Play,
  Wrench,
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
  /** Auto-advance past this step when its target isn't on screen (conditional
      dialog sections, platform-only toggles). Re-checked after 600 ms so tab
      switches and dialog animations get a chance to mount the target. */
  skipIfMissing?: boolean;
}

export const QBANK_HUB_STEPS: WalkthroughStep[] = [
  {
    id: "qbank-hub-create-tab",
    targetSelector: "[data-walkthrough='qbank-create-tab-btn']",
    titleKey: "walkthrough.qbankHub.step1.title",
    subtitleKey: "walkthrough.qbankHub.step1.subtitle",
    mainIcon: Plus,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
    onEnterTab: "create",
  },
  {
    id: "qbank-hub-create-mode",
    targetSelector: "[data-walkthrough='qbank-create-mode']",
    titleKey: "walkthrough.qbankHub.step2.title",
    subtitleKey: "walkthrough.qbankHub.step2.subtitle",
    mainIcon: Sparkles,
    preferredPlacement: "bottom",
    highlightPadding: 8,
    highlightRadius: 14,
    skipIfMissing: true,
  },
  {
    id: "qbank-hub-create-start",
    targetSelector: "[data-walkthrough='qbank-create-start']",
    titleKey: "walkthrough.qbankHub.step3.title",
    subtitleKey: "walkthrough.qbankHub.step3.subtitle",
    mainIcon: Play,
    preferredPlacement: "top",
    highlightPadding: 8,
    highlightRadius: 14,
    skipIfMissing: true,
  },
  {
    id: "qbank-hub-tracker-tab",
    targetSelector: "[data-walkthrough='qbank-tracker-tab-btn']",
    titleKey: "walkthrough.qbankHub.step4.title",
    subtitleKey: "walkthrough.qbankHub.step4.subtitle",
    mainIcon: BarChart2,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
    onEnterTab: "tracker",
  },
  {
    id: "qbank-hub-packs",
    targetSelector: "[data-walkthrough='qbank-packs']",
    titleKey: "walkthrough.qbankHub.step5.title",
    subtitleKey: "walkthrough.qbankHub.step5.subtitle",
    mainIcon: GraduationCap,
    preferredPlacement: "top",
    highlightPadding: 8,
    highlightRadius: 16,
    onEnterTab: "content",
  },
  {
    id: "qbank-hub-launch-mode",
    targetSelector: "[data-walkthrough='launch-mode']",
    titleKey: "walkthrough.qbankHub.step6.title",
    subtitleKey: "walkthrough.qbankHub.step6.subtitle",
    mainIcon: Sparkles,
    preferredPlacement: "bottom",
    highlightPadding: 8,
    highlightRadius: 14,
    skipIfMissing: true,
  },
  {
    id: "qbank-hub-launch-chapters",
    targetSelector: "[data-walkthrough='launch-chapters']",
    titleKey: "walkthrough.qbankHub.step7.title",
    subtitleKey: "walkthrough.qbankHub.step7.subtitle",
    mainIcon: BookmarkCheck,
    preferredPlacement: "bottom",
    highlightPadding: 8,
    highlightRadius: 14,
    skipIfMissing: true,
  },
  {
    id: "qbank-hub-launch-filters",
    targetSelector: "[data-walkthrough='launch-filters']",
    titleKey: "walkthrough.qbankHub.step8.title",
    subtitleKey: "walkthrough.qbankHub.step8.subtitle",
    mainIcon: Flag,
    preferredPlacement: "bottom",
    highlightPadding: 8,
    highlightRadius: 14,
    skipIfMissing: true,
  },
  {
    id: "qbank-hub-launch-count",
    targetSelector: "[data-walkthrough='launch-count']",
    titleKey: "walkthrough.qbankHub.step9.title",
    subtitleKey: "walkthrough.qbankHub.step9.subtitle",
    mainIcon: Layers,
    preferredPlacement: "top",
    highlightPadding: 8,
    highlightRadius: 14,
    skipIfMissing: true,
  },
  {
    id: "qbank-hub-launch-start",
    targetSelector: "[data-walkthrough='launch-start']",
    titleKey: "walkthrough.qbankHub.step10.title",
    subtitleKey: "walkthrough.qbankHub.step10.subtitle",
    mainIcon: Play,
    preferredPlacement: "top",
    highlightPadding: 8,
    highlightRadius: 12,
    skipIfMissing: true,
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
    skipIfMissing: true,
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
    skipIfMissing: true,
  },
  {
    id: "qbank-settings",
    targetSelector: "[data-walkthrough='qbank-settings']",
    titleKey: "walkthrough.qbank.step4.title",
    subtitleKey: "walkthrough.qbank.step4.subtitle",
    mainIcon: Sliders,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
  },
  {
    id: "qbank-navigator",
    targetSelector: "[data-walkthrough='qbank-navigator']",
    titleKey: "walkthrough.qbank.step5.title",
    subtitleKey: "walkthrough.qbank.step5.subtitle",
    mainIcon: Flag,
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
    id: "qbank-clinical-tools",
    targetSelector: "[data-walkthrough='qbank-tools']",
    titleKey: "walkthrough.qbank.step7.title",
    subtitleKey: "walkthrough.qbank.step7.subtitle",
    mainIcon: Wrench,
    preferredPlacement: "top",
    highlightPadding: 6,
    highlightRadius: 12,
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
    skipIfMissing: true,
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
    skipIfMissing: true,
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
    skipIfMissing: true,
  },
  {
    id: "library-bookmark",
    targetSelector: "[data-walkthrough='library-bookmark']",
    titleKey: "walkthrough.library.step5.title",
    subtitleKey: "walkthrough.library.step5.subtitle",
    mainIcon: Bookmark,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
    skipIfMissing: true,
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
    skipIfMissing: true,
  },
  {
    id: "library-reporting",
    targetSelector: "[data-walkthrough='library-reporting']",
    titleKey: "walkthrough.library.step7.title",
    subtitleKey: "walkthrough.library.step7.subtitle",
    mainIcon: MessageSquareWarning,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
    skipIfMissing: true,
  },
];

export function getTourSteps(tour: TourId): WalkthroughStep[] {
  if (tour === "qbank" || tour === "qbank-hub") return QBANK_HUB_STEPS;
  if (tour === "qbank-session") return QBANK_SESSION_STEPS;
  return LIBRARY_STEPS;
}

// Re-export for compatibility
export const QBANK_STEPS = QBANK_SESSION_STEPS;


