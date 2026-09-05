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
  Search,
  BookOpenText,
  List,
  Share2,
  BookmarkCheck,
  ZoomIn,
  AlignLeft,
  CloudDownload,
  Printer,
  type LucideIcon,
} from "lucide-react";
import type { StringKey } from "@/lib/osler/i18n";

export type TourId = "qbank" | "library";

export interface WalkthroughFeature {
  icon: LucideIcon;
  titleKey: StringKey;
  descKey: StringKey;
  tag?: string;
  isSpecial?: "settings" | "report";
}

export interface WalkthroughStep {
  id: string;
  badgeKey: StringKey;
  titleKey: StringKey;
  subtitleKey: StringKey;
  mainIcon: LucideIcon;
  features: WalkthroughFeature[];
  tip?: {
    type: "settings" | "report" | "info";
    titleKey: StringKey;
    bodyKey: StringKey;
    icon: LucideIcon;
  };
}

export const QBANK_STEPS: WalkthroughStep[] = [
  {
    id: "qbank-modes",
    badgeKey: "walkthrough.qbank.badge",
    titleKey: "walkthrough.qbank.step1.title",
    subtitleKey: "walkthrough.qbank.step1.subtitle",
    mainIcon: GraduationCap,
    features: [
      {
        icon: GraduationCap,
        titleKey: "walkthrough.qbank.step1.feat1",
        descKey: "walkthrough.qbank.step1.feat1Desc",
        tag: "Learning",
      },
      {
        icon: Clock,
        titleKey: "walkthrough.qbank.step1.feat2",
        descKey: "walkthrough.qbank.step1.feat2Desc",
        tag: "Exam Simulation",
      },
      {
        icon: ListFilter,
        titleKey: "walkthrough.qbank.step1.feat3",
        descKey: "walkthrough.qbank.step1.feat3Desc",
        tag: "Custom Filters",
      },
    ],
  },
  {
    id: "qbank-question-ui",
    badgeKey: "walkthrough.qbank.badge",
    titleKey: "walkthrough.qbank.step2.title",
    subtitleKey: "walkthrough.qbank.step2.subtitle",
    mainIcon: FileText,
    features: [
      {
        icon: ScanEye,
        titleKey: "walkthrough.qbank.step2.feat1",
        descKey: "walkthrough.qbank.step2.feat1Desc",
      },
      {
        icon: FileText,
        titleKey: "walkthrough.qbank.step2.feat2",
        descKey: "walkthrough.qbank.step2.feat2Desc",
      },
      {
        icon: Sparkles,
        titleKey: "walkthrough.qbank.step2.feat3",
        descKey: "walkthrough.qbank.step2.feat3Desc",
      },
    ],
  },
  {
    id: "qbank-explanations",
    badgeKey: "walkthrough.qbank.badge",
    titleKey: "walkthrough.qbank.step3.title",
    subtitleKey: "walkthrough.qbank.step3.subtitle",
    mainIcon: CheckCircle2,
    features: [
      {
        icon: CheckCircle2,
        titleKey: "walkthrough.qbank.step3.feat1",
        descKey: "walkthrough.qbank.step3.feat1Desc",
      },
      {
        icon: BarChart2,
        titleKey: "walkthrough.qbank.step3.feat2",
        descKey: "walkthrough.qbank.step3.feat2Desc",
        tag: "Peer Analytics",
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
    id: "qbank-tools",
    badgeKey: "walkthrough.qbank.badge",
    titleKey: "walkthrough.qbank.step4.title",
    subtitleKey: "walkthrough.qbank.step4.subtitle",
    mainIcon: Calculator,
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
    badgeKey: "walkthrough.qbank.badge",
    titleKey: "walkthrough.qbank.step5.title",
    subtitleKey: "walkthrough.qbank.step5.subtitle",
    mainIcon: Sliders,
    features: [
      {
        icon: Sliders,
        titleKey: "walkthrough.qbank.step5.feat1",
        descKey: "walkthrough.qbank.step5.feat1Desc",
        isSpecial: "settings",
      },
      {
        icon: Clock,
        titleKey: "walkthrough.qbank.step5.feat2",
        descKey: "walkthrough.qbank.step5.feat2Desc",
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
    badgeKey: "walkthrough.qbank.badge",
    titleKey: "walkthrough.qbank.step6.title",
    subtitleKey: "walkthrough.qbank.step6.subtitle",
    mainIcon: MessageSquareWarning,
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
      {
        icon: Sparkles,
        titleKey: "walkthrough.qbank.step6.feat3",
        descKey: "walkthrough.qbank.step6.feat3Desc",
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
    badgeKey: "walkthrough.qbank.badge",
    titleKey: "walkthrough.qbank.step7.title",
    subtitleKey: "walkthrough.qbank.step7.subtitle",
    mainIcon: Grid3x3,
    features: [
      {
        icon: Grid3x3,
        titleKey: "walkthrough.qbank.step7.feat1",
        descKey: "walkthrough.qbank.step7.feat1Desc",
      },
      {
        icon: Clock,
        titleKey: "walkthrough.qbank.step7.feat2",
        descKey: "walkthrough.qbank.step7.feat2Desc",
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
    badgeKey: "walkthrough.library.badge",
    titleKey: "walkthrough.library.step1.title",
    subtitleKey: "walkthrough.library.step1.subtitle",
    mainIcon: Library,
    features: [
      {
        icon: FolderTree,
        titleKey: "walkthrough.library.step1.feat1",
        descKey: "walkthrough.library.step1.feat1Desc",
        tag: "Specialties",
      },
      {
        icon: Search,
        titleKey: "walkthrough.library.step1.feat2",
        descKey: "walkthrough.library.step1.feat2Desc",
        tag: "Global Search",
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
    badgeKey: "walkthrough.library.badge",
    titleKey: "walkthrough.library.step2.title",
    subtitleKey: "walkthrough.library.step2.subtitle",
    mainIcon: BookOpenText,
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
      {
        icon: Share2,
        titleKey: "walkthrough.library.step2.feat3",
        descKey: "walkthrough.library.step2.feat3Desc",
      },
    ],
  },
  {
    id: "library-tools",
    badgeKey: "walkthrough.library.badge",
    titleKey: "walkthrough.library.step3.title",
    subtitleKey: "walkthrough.library.step3.subtitle",
    mainIcon: Highlighter,
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
      {
        icon: BookmarkCheck,
        titleKey: "walkthrough.library.step3.feat3",
        descKey: "walkthrough.library.step3.feat3Desc",
      },
    ],
  },
  {
    id: "library-display",
    badgeKey: "walkthrough.library.badge",
    titleKey: "walkthrough.library.step4.title",
    subtitleKey: "walkthrough.library.step4.subtitle",
    mainIcon: Type,
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
      {
        icon: AlignLeft,
        titleKey: "walkthrough.library.step4.feat3",
        descKey: "walkthrough.library.step4.feat3Desc",
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
    badgeKey: "walkthrough.library.badge",
    titleKey: "walkthrough.library.step5.title",
    subtitleKey: "walkthrough.library.step5.subtitle",
    mainIcon: MessageSquareWarning,
    features: [
      {
        icon: MessageSquareWarning,
        titleKey: "walkthrough.library.step5.feat1",
        descKey: "walkthrough.library.step5.feat1Desc",
        isSpecial: "report",
      },
      {
        icon: FolderTree,
        titleKey: "walkthrough.library.step5.feat2",
        descKey: "walkthrough.library.step5.feat2Desc",
      },
      {
        icon: Sparkles,
        titleKey: "walkthrough.library.step5.feat3",
        descKey: "walkthrough.library.step5.feat3Desc",
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
    badgeKey: "walkthrough.library.badge",
    titleKey: "walkthrough.library.step6.title",
    subtitleKey: "walkthrough.library.step6.subtitle",
    mainIcon: CloudDownload,
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
      {
        icon: Printer,
        titleKey: "walkthrough.library.step6.feat3",
        descKey: "walkthrough.library.step6.feat3Desc",
      },
    ],
  },
];

export function getTourSteps(tour: TourId): WalkthroughStep[] {
  return tour === "qbank" ? QBANK_STEPS : LIBRARY_STEPS;
}
