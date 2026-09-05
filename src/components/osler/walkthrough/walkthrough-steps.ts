"use client";

import {
  GraduationCap,
  Clock,
  ListFilter,
  FileText,
  ScanEye,
  CheckCircle2,
  BarChart2,
  Sparkles,
  Calculator,
  FlaskConical,
  NotebookPen,
  Highlighter,
  Sliders,
  Type,
  MessageSquareWarning,
  Flag,
  Grid3x3,
  Award,
  Library,
  FolderTree,
  BookOpenText,
  List,
  BookmarkCheck,
  ZoomIn,
  CloudDownload,
  Printer,
  Compass,
  Activity,
  Plus,
  type LucideIcon,
} from "lucide-react";
import type { StringKey } from "@/lib/osler/i18n";

export type TourId = "qbank" | "qbank-hub" | "qbank-session" | "library";

export interface WalkthroughFeature {
  icon: LucideIcon;
  titleKey: StringKey;
  descKey: StringKey;
  tag?: string;
  isSpecial?: "settings" | "report";
}

export interface WalkthroughStep {
  id: string;
  targetSelector: string;
  badgeKey: StringKey;
  titleKey: StringKey;
  subtitleKey: StringKey;
  mainIcon: LucideIcon;
  features?: WalkthroughFeature[];
  tip?: {
    type: "settings" | "report" | "info";
    titleKey: StringKey;
    bodyKey: StringKey;
    icon: LucideIcon;
  };
  preferredPlacement?: "top" | "bottom" | "left" | "right" | "auto";
  highlightPadding?: number;
  highlightRadius?: number;
  onEnterTab?: string;
}

export const QBANK_HUB_STEPS: WalkthroughStep[] = [
  {
    id: "qbank-hub-tabs",
    targetSelector: "[data-walkthrough='qbank-tabs']",
    badgeKey: "walkthrough.qbankHub.badge",
    titleKey: "walkthrough.qbankHub.step1.title",
    subtitleKey: "walkthrough.qbankHub.step1.subtitle",
    mainIcon: Grid3x3,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 12,
    features: [
      {
        icon: Grid3x3,
        titleKey: "walkthrough.qbank.step1.feat1",
        descKey: "walkthrough.qbank.step1.feat1Desc",
        tag: "Tutor & Exam",
      },
      {
        icon: Plus,
        titleKey: "walkthrough.qbank.step1.feat3",
        descKey: "walkthrough.qbank.step1.feat3Desc",
        tag: "Custom Test",
      },
      {
        icon: Activity,
        titleKey: "walkthrough.qbankHub.step4.title",
        descKey: "walkthrough.qbankHub.step4.subtitle",
        tag: "Tracker",
      },
    ],
  },
  {
    id: "qbank-hub-packs",
    targetSelector: "[data-walkthrough='qbank-packs']",
    badgeKey: "walkthrough.qbankHub.badge",
    titleKey: "walkthrough.qbankHub.step2.title",
    subtitleKey: "walkthrough.qbankHub.step2.subtitle",
    mainIcon: GraduationCap,
    preferredPlacement: "top",
    highlightPadding: 8,
    highlightRadius: 16,
    features: [
      {
        icon: FolderTree,
        titleKey: "walkthrough.library.step1.feat1",
        descKey: "walkthrough.qbankHub.step2.subtitle",
      },
      {
        icon: Sparkles,
        titleKey: "walkthrough.qbank.step3.feat3",
        descKey: "walkthrough.qbank.step3.feat3Desc",
        tag: "High Yield",
      },
    ],
  },
  {
    id: "qbank-hub-create",
    targetSelector: "[data-walkthrough='qbank-create-tab-btn']",
    badgeKey: "walkthrough.qbankHub.badge",
    titleKey: "walkthrough.qbankHub.step3.title",
    subtitleKey: "walkthrough.qbankHub.step3.subtitle",
    mainIcon: ListFilter,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
    features: [
      {
        icon: ListFilter,
        titleKey: "walkthrough.qbank.step1.feat3",
        descKey: "walkthrough.qbank.step1.feat3Desc",
      },
      {
        icon: Clock,
        titleKey: "walkthrough.qbank.step1.feat2",
        descKey: "walkthrough.qbank.step1.feat2Desc",
      },
    ],
  },
  {
    id: "qbank-hub-tracker",
    targetSelector: "[data-walkthrough='qbank-tracker-tab-btn']",
    badgeKey: "walkthrough.qbankHub.badge",
    titleKey: "walkthrough.qbankHub.step4.title",
    subtitleKey: "walkthrough.qbankHub.step4.subtitle",
    mainIcon: BarChart2,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
    features: [
      {
        icon: BarChart2,
        titleKey: "walkthrough.qbank.step3.feat2",
        descKey: "walkthrough.qbank.step3.feat2Desc",
      },
      {
        icon: Award,
        titleKey: "walkthrough.qbank.step7.feat3",
        descKey: "walkthrough.qbank.step7.feat3Desc",
      },
    ],
  },
  {
    id: "qbank-hub-guide-btn",
    targetSelector: "[data-walkthrough='qbank-guide-btn']",
    badgeKey: "walkthrough.qbankHub.badge",
    titleKey: "walkthrough.qbankHub.step5.title",
    subtitleKey: "walkthrough.qbankHub.step5.subtitle",
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
    badgeKey: "walkthrough.qbank.badge",
    titleKey: "walkthrough.qbank.step1.title",
    subtitleKey: "walkthrough.qbank.step1.subtitle",
    mainIcon: Clock,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 12,
    features: [
      {
        icon: GraduationCap,
        titleKey: "walkthrough.qbank.step1.feat1",
        descKey: "walkthrough.qbank.step1.feat1Desc",
      },
      {
        icon: Clock,
        titleKey: "walkthrough.qbank.step1.feat2",
        descKey: "walkthrough.qbank.step1.feat2Desc",
      },
    ],
  },
  {
    id: "qbank-question-stem",
    targetSelector: "[data-walkthrough='qbank-question-stem']",
    badgeKey: "walkthrough.qbank.badge",
    titleKey: "walkthrough.qbank.step2.title",
    subtitleKey: "walkthrough.qbank.step2.subtitle",
    mainIcon: FileText,
    preferredPlacement: "bottom",
    highlightPadding: 8,
    highlightRadius: 14,
    features: [
      {
        icon: ScanEye,
        titleKey: "walkthrough.qbank.step2.feat1",
        descKey: "walkthrough.qbank.step2.feat1Desc",
      },
      {
        icon: Sparkles,
        titleKey: "walkthrough.qbank.step2.feat3",
        descKey: "walkthrough.qbank.step2.feat3Desc",
      },
    ],
  },
  {
    id: "qbank-options",
    targetSelector: "[data-walkthrough='qbank-options']",
    badgeKey: "walkthrough.qbank.badge",
    titleKey: "walkthrough.qbank.step3.title",
    subtitleKey: "walkthrough.qbank.step3.subtitle",
    mainIcon: CheckCircle2,
    preferredPlacement: "top",
    highlightPadding: 8,
    highlightRadius: 14,
    features: [
      {
        icon: CheckCircle2,
        titleKey: "walkthrough.qbank.step2.feat2",
        descKey: "walkthrough.qbank.step2.feat2Desc",
      },
      {
        icon: BarChart2,
        titleKey: "walkthrough.qbank.step3.feat2",
        descKey: "walkthrough.qbank.step3.feat2Desc",
        tag: "Peer Analytics",
      },
    ],
  },
  {
    id: "qbank-tools",
    targetSelector: "[data-walkthrough='qbank-tools']",
    badgeKey: "walkthrough.qbank.badge",
    titleKey: "walkthrough.qbank.step4.title",
    subtitleKey: "walkthrough.qbank.step4.subtitle",
    mainIcon: Calculator,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 12,
    features: [
      {
        icon: Calculator,
        titleKey: "walkthrough.qbank.step4.feat1",
        descKey: "walkthrough.qbank.step4.feat1Desc",
      },
      {
        icon: FlaskConical,
        titleKey: "walkthrough.qbank.step4.feat2",
        descKey: "walkthrough.qbank.step4.feat2Desc",
      },
      {
        icon: NotebookPen,
        titleKey: "walkthrough.qbank.step4.feat3",
        descKey: "walkthrough.qbank.step4.feat3Desc",
      },
    ],
  },
  {
    id: "qbank-settings",
    targetSelector: "[data-walkthrough='qbank-settings']",
    badgeKey: "walkthrough.qbank.badge",
    titleKey: "walkthrough.qbank.step5.title",
    subtitleKey: "walkthrough.qbank.step5.subtitle",
    mainIcon: Sliders,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
    features: [
      {
        icon: Sliders,
        titleKey: "walkthrough.qbank.step5.feat1",
        descKey: "walkthrough.qbank.step5.feat1Desc",
        isSpecial: "settings",
      },
      {
        icon: Type,
        titleKey: "walkthrough.qbank.step5.feat3",
        descKey: "walkthrough.qbank.step5.feat3Desc",
      },
    ],
    tip: {
      type: "settings",
      titleKey: "walkthrough.settingsTipTitle",
      bodyKey: "walkthrough.qbank.step5.feat1Desc",
      icon: Sliders,
    },
  },
  {
    id: "qbank-reporting",
    targetSelector: "[data-walkthrough='qbank-reporting']",
    badgeKey: "walkthrough.qbank.badge",
    titleKey: "walkthrough.qbank.step6.title",
    subtitleKey: "walkthrough.qbank.step6.subtitle",
    mainIcon: MessageSquareWarning,
    preferredPlacement: "top",
    highlightPadding: 6,
    highlightRadius: 10,
    features: [
      {
        icon: Flag,
        titleKey: "walkthrough.qbank.step6.feat1",
        descKey: "walkthrough.qbank.step6.feat1Desc",
        isSpecial: "report",
      },
      {
        icon: MessageSquareWarning,
        titleKey: "walkthrough.qbank.step6.feat2",
        descKey: "walkthrough.qbank.step6.feat2Desc",
      },
    ],
    tip: {
      type: "report",
      titleKey: "walkthrough.reportTipTitle",
      bodyKey: "walkthrough.qbank.step6.feat2Desc",
      icon: MessageSquareWarning,
    },
  },
  {
    id: "qbank-navigator",
    targetSelector: "[data-walkthrough='qbank-navigator']",
    badgeKey: "walkthrough.qbank.badge",
    titleKey: "walkthrough.qbank.step7.title",
    subtitleKey: "walkthrough.qbank.step7.subtitle",
    mainIcon: Grid3x3,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
    features: [
      {
        icon: Grid3x3,
        titleKey: "walkthrough.qbank.step7.feat1",
        descKey: "walkthrough.qbank.step7.feat1Desc",
      },
      {
        icon: Award,
        titleKey: "walkthrough.qbank.step7.feat3",
        descKey: "walkthrough.qbank.step7.feat3Desc",
      },
    ],
  },
];

export const LIBRARY_STEPS: WalkthroughStep[] = [
  {
    id: "library-knowledge",
    targetSelector: "[data-walkthrough='library-tree']",
    badgeKey: "walkthrough.library.badge",
    titleKey: "walkthrough.library.step1.title",
    subtitleKey: "walkthrough.library.step1.subtitle",
    mainIcon: Library,
    preferredPlacement: "right",
    highlightPadding: 8,
    highlightRadius: 14,
    features: [
      {
        icon: FolderTree,
        titleKey: "walkthrough.library.step1.feat1",
        descKey: "walkthrough.library.step1.feat1Desc",
        tag: "Specialties",
      },
      {
        icon: BookmarkCheck,
        titleKey: "walkthrough.library.step1.feat3",
        descKey: "walkthrough.library.step1.feat3Desc",
        tag: "Bookmarks",
      },
    ],
  },
  {
    id: "library-toc",
    targetSelector: "[data-walkthrough='library-tabs']",
    badgeKey: "walkthrough.library.badge",
    titleKey: "walkthrough.library.step2.title",
    subtitleKey: "walkthrough.library.step2.subtitle",
    mainIcon: BookOpenText,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
    features: [
      {
        icon: List,
        titleKey: "walkthrough.library.step2.feat1",
        descKey: "walkthrough.library.step2.feat1Desc",
      },
      {
        icon: Clock,
        titleKey: "walkthrough.library.step2.feat2",
        descKey: "walkthrough.library.step2.feat2Desc",
      },
    ],
  },
  {
    id: "library-tools",
    targetSelector: "[data-walkthrough='library-tools']",
    badgeKey: "walkthrough.library.badge",
    titleKey: "walkthrough.library.step3.title",
    subtitleKey: "walkthrough.library.step3.subtitle",
    mainIcon: Highlighter,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 12,
    features: [
      {
        icon: Highlighter,
        titleKey: "walkthrough.library.step3.feat1",
        descKey: "walkthrough.library.step3.feat1Desc",
      },
      {
        icon: NotebookPen,
        titleKey: "walkthrough.library.step3.feat2",
        descKey: "walkthrough.library.step3.feat2Desc",
      },
    ],
  },
  {
    id: "library-display",
    targetSelector: "[data-walkthrough='library-display']",
    badgeKey: "walkthrough.library.badge",
    titleKey: "walkthrough.library.step4.title",
    subtitleKey: "walkthrough.library.step4.subtitle",
    mainIcon: Type,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
    features: [
      {
        icon: Type,
        titleKey: "walkthrough.library.step4.feat1",
        descKey: "walkthrough.library.step4.feat1Desc",
        isSpecial: "settings",
      },
      {
        icon: ZoomIn,
        titleKey: "walkthrough.library.step4.feat2",
        descKey: "walkthrough.library.step4.feat2Desc",
      },
    ],
    tip: {
      type: "settings",
      titleKey: "walkthrough.settingsTipTitle",
      bodyKey: "walkthrough.library.step4.feat1Desc",
      icon: Type,
    },
  },
  {
    id: "library-reporting",
    targetSelector: "[data-walkthrough='library-reporting']",
    badgeKey: "walkthrough.library.badge",
    titleKey: "walkthrough.library.step5.title",
    subtitleKey: "walkthrough.library.step5.subtitle",
    mainIcon: MessageSquareWarning,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
    features: [
      {
        icon: MessageSquareWarning,
        titleKey: "walkthrough.library.step5.feat1",
        descKey: "walkthrough.library.step5.feat1Desc",
        isSpecial: "report",
      },
    ],
    tip: {
      type: "report",
      titleKey: "walkthrough.reportTipTitle",
      bodyKey: "walkthrough.library.step5.feat2Desc",
      icon: MessageSquareWarning,
    },
  },
  {
    id: "library-offline-pdf",
    targetSelector: "[data-walkthrough='library-export']",
    badgeKey: "walkthrough.library.badge",
    titleKey: "walkthrough.library.step6.title",
    subtitleKey: "walkthrough.library.step6.subtitle",
    mainIcon: CloudDownload,
    preferredPlacement: "bottom",
    highlightPadding: 6,
    highlightRadius: 10,
    features: [
      {
        icon: CloudDownload,
        titleKey: "walkthrough.library.step6.feat1",
        descKey: "walkthrough.library.step6.feat1Desc",
        tag: "Offline",
      },
      {
        icon: Printer,
        titleKey: "walkthrough.library.step6.feat2",
        descKey: "walkthrough.library.step6.feat2Desc",
        tag: "PDF",
      },
    ],
  },
];

export function getTourSteps(tour: TourId): WalkthroughStep[] {
  if (tour === "qbank" || tour === "qbank-hub") {
    return QBANK_HUB_STEPS;
  }
  if (tour === "qbank-session") {
    return QBANK_SESSION_STEPS;
  }
  return LIBRARY_STEPS;
}

// Re-export QBANK_STEPS for compatibility
export const QBANK_STEPS = QBANK_SESSION_STEPS;
