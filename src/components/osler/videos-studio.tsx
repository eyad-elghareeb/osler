"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PlayCircle,
  Play,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  Clock,
  Tag,
  Loader2,
  Folder,
  Video as VideoIcon,
  ListVideo,
  BookOpen,
  ExternalLink,
  Sun,
  ArrowDownUp,
  Check,
  CheckCircle2,
  Minus,
  Plus,
} from "lucide-react";
import "plyr/dist/plyr.css";
import {
  loadVideoTree,
  loadNodeVideos,
  listAllVideos,
  resolveThumbnail,
  resolveVideoUrl,
  videoStreamKind,
  formatDuration,
} from "@/lib/osler/videos";
import { ENGINE_META, collectPackUrls, findNodeByUid, getCachedCategoryTree } from "@/lib/osler/content";
import { settings, videoWatch, videoProgress } from "@/lib/osler/storage";
import { useVideoWatch } from "@/hooks/use-video-watch";
import type { VideoResource, ContentTreeNode } from "@/lib/osler/types";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { setImmersiveMode } from "./immersive-mode";
import { useShortcutListener } from "@/hooks/use-shortcuts";
import { useI18n } from "./i18n-provider";
import { HubSkeleton, EmptyState, ComingSoonState, PageHeader, SectionHeading, MetricBar } from "./ui-primitives";
import { NavigationStack } from "./navigation-stack";
import { ContentCacheButton } from "./content-cache-button";
import {
  acquireWakeLock,
  releaseWakeLock,
  isWakeLockSupported,
  haptic,
} from "@/lib/osler/native";
import { useSwipeBackDismiss } from "@/hooks/use-swipe-back-dismiss";
import { staggerContainer, fadeUp } from "@/lib/osler/motion";

/* ── Constants ─────────────────────────────────────────────────────── */

const VIDEO_COLOR = ENGINE_META.video.color;

/**
 * Speeds offered in the Plyr settings menu and the quick preset list.
 * Direct-file backends (mp4 / hls / r2 via Plyr) honor the full 0.25–4×
 * range through `video.playbackRate`. YouTube's IFrame API caps at 2×, so
 * the YouTube backend gets the capped subset — users never see a preset
 * the player can't honor.
 */
const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];
const SPEED_MIN = 0.25;
const SPEED_MAX = 4;
const YT_MAX_RATE = 2;
const YT_PLAYBACK_RATES = PLAYBACK_RATES.filter((r) => r <= YT_MAX_RATE);
const SPEED_STEP = 0.1;

/** Resume only when past the intro seconds… */
const RESUME_MIN_S = 5;
/** …and never into the last seconds (counts as finished). */
const FINISH_MARGIN_S = 10;
/** Position writes are throttled to this cadence; pause/unmount flush. */
const PROGRESS_SAVE_MS = 5000;

function clampRate(next: number): number {
  const rounded = Math.round(next * 100) / 100;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, rounded));
}

function parseStoredRate(val: string | null | undefined): number {
  if (val == null) return 1;
  const n = Number.parseFloat(val);
  if (!Number.isFinite(n)) return 1;
  return clampRate(n);
}

/** "1x" / "1.5x" / "2.25x" — trims float drift from repeated ±0.1 steps. */
function fmtRate(r: number): string {
  return `${String(Number.parseFloat(r.toFixed(2)))}x`;
}

/** Saved position → resume offset, or undefined when the video is fresh,
 *  barely started, or was left inside the finish margin (counts as done). */
function resumeFromEntry(e: { t: number; d?: number } | null): number | undefined {
  if (!e || !Number.isFinite(e.t) || e.t < RESUME_MIN_S) return undefined;
  if (e.d != null && Number.isFinite(e.d) && e.d > 0 && e.t >= e.d - FINISH_MARGIN_S) return undefined;
  return Math.floor(e.t);
}

/** Alternative YouTube frontend host (set via NEXT_PUBLIC_INVIDIOUS_HOST in .env.local). */
const INVIDIOUS_HOST = process.env.NEXT_PUBLIC_INVIDIOUS_HOST;

/**
 * Module-level player-pref cache. The stored prefs arrive async, but the
 * player boot effect keys off them — without this cache every open boots
 * the default player, then tears it down and reboots when the stored pref
 * lands (visible player flash + double API load whenever the pref differs
 * from the build default).
 */
let cachedAltHost: boolean | null = null;
let cachedAutoplay: boolean | null = null;
let cachedSpeed: number | null = null;

/* ── Helpers ───────────────────────────────────────────────────────── */

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

/* ── Component ─────────────────────────────────────────────────────── */

import { useOslerRouter, routeFor } from "@/lib/osler/navigation";
import { ctxLinkAttrs } from "@/lib/osler/deep-link";

interface VideosStudioProps {
  /** Pre-selected video (used for deep links). */
  initialVideoId?: string;
  /** Optional callback to open a library article. */
  onOpenArticle?: (id: string) => void;
  /** Called when the user swipes back to navigate to the Learn hub. */
  onNavigateBack?: () => void;
}

export function VideosStudio({
  initialVideoId,
  onOpenArticle: propOnOpenArticle,
  onNavigateBack: propOnNavigateBack,
}: VideosStudioProps = {}) {
  const { t, contentFilter, rtl } = useI18n();
  const { navigate } = useOslerRouter();

  const onNavigateBack = propOnNavigateBack || (() => navigate("learn"));
  const onOpenArticle = propOnOpenArticle || ((id: string) => navigate("library", { article: id }));

  const [tree, setTree] = React.useState<ContentTreeNode[]>(() => getCachedCategoryTree("video") ?? []);
  // Tracks the initial tree/video-list fetch only (not per-folder loads,
  // which already have their own `folderLoading` shimmer grid) — without
  // this the hub previously rendered as if it were genuinely empty for a
  // frame before data arrived. Seeded from the sync manifest cache so a
  // warm revisit paints instantly instead of flashing the skeleton.
  // See design-library-roadmap.md.
  const [treeLoading, setTreeLoading] = React.useState(() => getCachedCategoryTree("video") === null);
  // Folder drill-down path (root → … → current), stored as uids so a tree
  // reload re-resolves fresh node objects. [] = root folder grid. Supports
  // arbitrary nesting depth, like the QBank Content tab.
  const [folderUidPath, setFolderUidPath] = React.useState<string[]>([]);
  const [folderVideos, setFolderVideos] = React.useState<VideoResource[]>([]);
  const [folderLoading, setFolderLoading] = React.useState(false);
  // Sort ("more options" layer). Content search lives in the global
  // search bar (AppShell → GlobalSearchPanel), not per-view.
  const [sortMode, setSortMode] = React.useState<"default" | "longest" | "shortest" | "title">("default");
  // Watch-history filter — backed by the synced videoWatch store so viewed /
  // unviewed state follows the user across devices.
  const [watchFilter, setWatchFilter] = React.useState<"all" | "watched" | "unwatched">("all");
  const watchedIds = useVideoWatch();

  // The active video being played (or null = hub view).
  const [activeVideo, setActiveVideo] = React.useState<(VideoResource & { nodeUid: string; nodePath: string }) | null>(null);
  // Playlist: list of other videos in the same folder (for "up next").
  const [playlist, setPlaylist] = React.useState<VideoResource[]>([]);

  // Swipe-back gesture to navigate to Learn hub — disabled while watching
  // a video or while a folder subpage is open (the NavigationStack owns the
  // drag there and pops one level per swipe).
  const swipeDismissProps = useSwipeBackDismiss({
    onDismiss: () => {
      if (activeVideo) closeVideo();
      else onNavigateBack?.();
    },
    direction: "horizontal",
    rtl,
    disabled: !!activeVideo || folderUidPath.length > 0,
  });

  /* ── Load tree (manifest) only — folder videos load on demand ── */
  const loadTreeData = React.useCallback(() => {
    (async () => {
      try {
        const treeData = await loadVideoTree();
        setTree(treeData);
        // Drop drill-down levels whose nodes vanished (admin removed a folder).
        setFolderUidPath((curr) => {
          const pruned = curr.filter((uid) => findNodeByUid(treeData, uid) !== null);
          return pruned.length === curr.length ? curr : pruned;
        });
        // Warm every leaf's videos in the background so the first paint and
        // later folder switches read from cache instead of chaining serial
        // network round trips (tree → leaf JSON → thumbnails).
        void Promise.all(treeData.flatMap(collectLeaves).map((leaf) => loadNodeVideos(leaf))).catch(() => {
          // Best-effort only — the hub loads each folder on demand anyway.
        });
      } catch (e) {
        console.error("Failed to load videos tree:", e);
      } finally {
        setTreeLoading(false);
      }
    })();
  }, []);

  React.useEffect(() => {
    loadTreeData();
    const handler = () => loadTreeData();
    window.addEventListener("osler-content-invalidated", handler);
    return () => window.removeEventListener("osler-content-invalidated", handler);
  }, [loadTreeData]);

  // The current drill-down folder (last path entry). Uids re-resolve
  // against the latest tree so reloads never serve stale node objects.
  const pathNodes = React.useMemo(
    () =>
      folderUidPath
        .map((uid) => findNodeByUid(tree, uid))
        .filter((n): n is ContentTreeNode => n !== null),
    [folderUidPath, tree],
  );
  const currentFolder = pathNodes.at(-1) ?? null;
  const currentUid = currentFolder?.uid ?? null;

  // Load videos in the current folder. Branch nodes aggregate every
  // descendant leaf (nested folders act as playlists). Each video is
  // stamped with its leaf's uid/path so the player can rebuild the
  // playlist for "Up next". Stale responses are dropped so rapid folder
  // switches can't overwrite the grid with the wrong folder's videos.
  // At the root ([] path) no videos load — the root shows folder cards only.
  const folderReqRef = React.useRef(0);
  React.useEffect(() => {
    if (!currentUid) {
      setFolderVideos([]);
      return;
    }
    const node = findNodeByUid(tree, currentUid);
    if (!node) {
      setFolderVideos([]);
      return;
    }
    folderReqRef.current += 1;
    const req = folderReqRef.current;
    setFolderLoading(true);
    const leaves = collectLeaves(node);
    Promise.all(leaves.map(loadNodeVideos))
      .then((arrays) => {
        if (folderReqRef.current !== req) return;
        const all = arrays.flatMap((vids, i) =>
          vids.map((v) => ({
            ...v,
            nodeUid: leaves[i].uid,
            nodePath: leaves[i].path,
            lang: v.lang ?? leaves[i].lang ?? "en",
          })),
        );
        if (contentFilter !== "all") {
          setFolderVideos(all.filter((v) => v.lang === contentFilter));
        } else {
          setFolderVideos(all);
        }
      })
      .catch((e) => {
        if (folderReqRef.current !== req) return;
        console.error("Failed to load folder videos:", e);
        setFolderVideos([]);
      })
      .finally(() => {
        if (folderReqRef.current !== req) return;
        setFolderLoading(false);
      });
  }, [currentUid, tree, contentFilter]);

  // Open initial video if provided — resolve it from the folder lists on
  // demand (the hub itself never fetches every video up front).
  React.useEffect(() => {
    if (!initialVideoId) return;
    let cancelled = false;
    listAllVideos()
      .then((all) => {
        if (cancelled) return;
        const found = all.find((v) => v.id === initialVideoId);
        if (found) openVideo(found);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialVideoId]);

  // Hide the global mobile tab bar while a video is playing.
  React.useEffect(() => {
    setImmersiveMode(!!activeVideo);
    return () => setImmersiveMode(false);
  }, [activeVideo]);

  /* ── Actions ── */
  function openVideo(video: VideoResource & { nodeUid?: string; nodePath?: string }) {
    setActiveVideo({ ...video, nodeUid: video.nodeUid ?? "", nodePath: video.nodePath ?? "" });
    // Build playlist: videos in the same folder as `video`.
    if (video.nodeUid) {
      const node = findNodeByUid(tree, video.nodeUid);
      if (node) {
        const leaves = collectLeaves(node);
        Promise.all(leaves.map(loadNodeVideos)).then((arrays) => {
          const flat = arrays.flat();
          setPlaylist(flat);
        });
      }
    }
  }

  function closeVideo() {
    setActiveVideo(null);
    setPlaylist([]);
  }

  function playNext() {
    if (!activeVideo || playlist.length === 0) return;
    const idx = playlist.findIndex((v) => v.id === activeVideo.id);
    if (idx < 0 || idx >= playlist.length - 1) return;
    openVideo({ ...playlist[idx + 1], nodeUid: activeVideo.nodeUid, nodePath: activeVideo.nodePath });
  }

  function playPrev() {
    if (!activeVideo || playlist.length === 0) return;
    const idx = playlist.findIndex((v) => v.id === activeVideo.id);
    if (idx <= 0) return;
    openVideo({ ...playlist[idx - 1], nodeUid: activeVideo.nodeUid, nodePath: activeVideo.nodePath });
  }

  // Sorted + watch-filtered view of the current folder's videos (hooks stay
  // above the player/skeleton early returns).
  const displayVideos = React.useMemo(() => {
    const filtered = watchFilter === "all"
      ? [...folderVideos]
      : folderVideos.filter((v) => (watchFilter === "watched") === watchedIds.has(v.id));
    if (sortMode === "longest") filtered.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
    else if (sortMode === "shortest") filtered.sort((a, b) => (a.duration ?? Infinity) - (b.duration ?? Infinity));
    else if (sortMode === "title") filtered.sort((a, b) => a.title.localeCompare(b.title));
    return filtered;
  }, [folderVideos, sortMode, watchFilter, watchedIds]);

  const watchedInFolder = React.useMemo(
    () => folderVideos.filter((v) => watchedIds.has(v.id)).length,
    [folderVideos, watchedIds],
  );

  const selectWatchFilter = React.useCallback((f: "all" | "watched" | "unwatched") => {
    haptic("selection");
    setWatchFilter(f);
  }, []);

  // Warm thumbnail bytes as soon as the folder's videos resolve so card
  // images paint from cache instead of starting after mount + lazy.
  React.useEffect(() => {
    if (typeof Image === "undefined") return;
    for (const v of displayVideos) {
      const t = resolveThumbnail(v);
      if (t) {
        const im = new Image();
        im.decoding = "async";
        im.src = t;
      }
    }
  }, [displayVideos]);

  // Root nodes visible under the content-language filter. Branches stay
  // intact so the user can always drill in; leaf packs filter by lang.
  const filteredRoots = React.useMemo(() => {
    if (contentFilter === "all") return tree;
    return tree.filter((node) => node.items.length > 0 || (node.lang ?? "en") === contentFilter);
  }, [tree, contentFilter]);

  const visibleChildren = React.useCallback(
    (node: ContentTreeNode): ContentTreeNode[] => {
      if (contentFilter === "all") return node.items;
      return node.items.filter((child) => child.items.length > 0 || (child.lang ?? "en") === contentFilter);
    },
    [contentFilter],
  );

  const pushFolder = React.useCallback((node: ContentTreeNode) => {
    haptic("selection");
    setFolderUidPath((p) => (p[p.length - 1] === node.uid ? p : [...p, node.uid]));
  }, []);

  const popFolder = React.useCallback(() => {
    haptic("selection");
    setFolderUidPath((p) => p.slice(0, -1));
  }, []);

  const totalVideos = React.useCallback(
    (node: ContentTreeNode): number => node.itemCount ?? node.questionCount ?? collectLeaves(node).length,
    [],
  );

  /* ── Render: Hub loading skeleton (initial tree fetch only) ── */
  if (treeLoading) {
    return <HubSkeleton statCount={0} cardCount={6} />;
  }

  // Sort control + offline download for a folder level header. Per-pack
  // content URLs come from the lib helper — branch nodes collect every
  // leaf descendant. Content search lives in the global search bar, not here.
  const renderLevelActions = (node: ContentTreeNode) => (
    <div className="flex items-center gap-2 shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5" aria-label={t("videos.sort")}>
            <ArrowDownUp className="size-3.5" />
            <span className="hidden sm:inline">
              {sortMode === "default"
                ? t("videos.sortDefault")
                : sortMode === "longest"
                  ? t("videos.sortLongest")
                  : sortMode === "shortest"
                    ? t("videos.sortShortest")
                    : t("videos.sortTitle")}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {([
            ["default", t("videos.sortDefault")],
            ["longest", t("videos.sortLongest")],
            ["shortest", t("videos.sortShortest")],
            ["title", t("videos.sortTitle")],
          ] as const).map(([mode, label]) => (
            <DropdownMenuItem
              key={mode}
              onClick={() => {
                haptic("selection");
                setSortMode(mode);
              }}
            >
              {label}
              {sortMode === mode && <Check className="size-3.5 ms-auto" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ContentCacheButton packId={node.uid} urls={collectPackUrls(node)} />
    </div>
  );

  // One folder card — branches drill deeper, leaf packs open their videos.
  // Same canonical card recipe as the QBank Content tab.
  const renderFolderCard = (node: ContentTreeNode, idx: number) => {
    const isBranch = node.items.length > 0;
    const videoCount = totalVideos(node);
    return (
      <button
        key={node.uid}
        type="button"
        onClick={() => pushFolder(node)}
        aria-label={node.title}
        className="osler-fade-in text-start bg-card border border-border rounded-xl p-5 hover:border-primary/40 hover:shadow-e2 transition-all group flex flex-col gap-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 w-full"
        style={{ animationDelay: `${Math.min(idx, 10) * 0.04}s` }}
      >
        <div className="flex items-center gap-3.5">
          <div
            className="size-12 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: `color-mix(in oklch, ${VIDEO_COLOR} 12%, transparent)`, color: VIDEO_COLOR }}
          >
            {isBranch ? <Folder className="size-6" /> : <VideoIcon className="size-6" />}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-sm truncate text-foreground leading-snug">{node.title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isBranch ? (
                <>
                  {t("videos.subfolders", { n: node.items.length })}
                  {" · "}
                  {t("videos.videosCount", { n: videoCount })}
                </>
              ) : (
                t("videos.videosCount", { n: videoCount })
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground/50">
            {isBranch ? t("videos.openFolder") : t("videos.play")}
          </span>
          <ChevronRight className={cn("size-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0", rtl && "rtl-flip-x")} />
        </div>
      </button>
    );
  };

  // Video grid for the current folder — while a new folder loads, keep
  // showing the previous folder's cards instead of flashing the skeleton;
  // the skeleton only shows on a genuinely empty grid.
  const renderVideoGrid = () => {
    if (folderLoading && folderVideos.length === 0) {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="osler-card--default">
              <Skeleton className="aspect-video w-full rounded-lg mb-3" />
              <Skeleton className="h-4 w-3/4 mb-2" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      );
    }
    if (displayVideos.length === 0) {
      // Filter-aware empty states: the history filters explain themselves
      // instead of looking like missing content.
      if (watchFilter === "watched") {
        return <EmptyState icon={CheckCircle2} title={t("videos.watched")} description={t("videos.noWatchedYet")} />;
      }
      if (watchFilter === "unwatched") {
        return <EmptyState icon={CheckCircle2} title={t("videos.unwatched")} description={t("videos.allWatched")} />;
      }
      return <ComingSoonState icon={VideoIcon} />;
    }
    return (
      // Same card animation as the dashboard grids: a shared stagger
      // container orchestrates per-card fadeUp entrances (no hand-rolled
      // per-card delays), with a subtle hover lift + tap scale.
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        {displayVideos.map((video, idx) => {
          const lang = video.lang ?? "en";
          return (
            <motion.button
              key={video.id}
              type="button"
              variants={fadeUp}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => { haptic("light"); openVideo(video); }}
              {...ctxLinkAttrs(routeFor("videos", { video: video.id }), video.title)}
              dir={lang === "ar" ? "rtl" : undefined}
              lang={lang}
              className={cn(
                "text-start group bg-card border border-border rounded-xl overflow-hidden hover:border-primary/40 hover:shadow-e2 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                lang === "ar" && "osler-content-ar"
              )}
            >
              {/* Thumbnail */}
              <div className="relative aspect-video bg-muted overflow-hidden">
                <VideoThumb video={video} eager={idx < 6} alt={video.title} />
                {/* Play overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-90" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div
                    className="size-12 rounded-full flex items-center justify-center backdrop-blur-sm bg-black/40 border border-white/30 text-white group-hover:scale-110 group-hover:bg-black/60 transition-all"
                  >
                    <Play className="size-5 ms-0.5" fill="currentColor" />
                  </div>
                </div>
                {/* Duration badge */}
                {video.duration != null && (
                  <div className="absolute bottom-2 end-2 px-1.5 py-0.5 rounded text-[11px] font-medium tabular-nums bg-black/70 text-white">
                    {formatDuration(video.duration)}
                  </div>
                )}
                {/* Specialty badge */}
                {video.specialty && (
                  <div className="absolute top-2 start-2 px-2 py-0.5 rounded-full text-[11px] font-medium bg-black/60 text-white backdrop-blur-sm">
                    {video.specialty}
                  </div>
                )}
                {/* Watched badge — state-only (the card root is already a
                    button, so this must not be interactive). */}
                {watchedIds.has(video.id) && (
                  <div className="absolute top-2 end-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-black/60 text-white backdrop-blur-sm">
                    <CheckCircle2 className="size-3" />
                    {t("videos.watched")}
                  </div>
                )}
              </div>

              {/* Meta */}
              <div className="p-3">
                <h3 className="text-sm font-semibold line-clamp-2 mb-1 group-hover:text-primary transition-colors">
                  {video.title}
                </h3>
                {video.instructor && (
                  <p className="text-xs text-muted-foreground line-clamp-1 mb-1.5">
                    {video.instructor}
                  </p>
                )}
                {video.tags && video.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {video.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-0.5 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border"
                      >
                        <Tag className="size-2" />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </motion.button>
          );
        })}
      </motion.div>
    );
  };

  // Root level — folder cards only (videos appear once inside a folder),
  // matching the QBank / Flashcards hub pattern.
  const homeView = (
    <div className="osler-page__inner--wide">
      <PageHeader
        inline
        inlineIcon={PlayCircle}
        inlineIconColor={VIDEO_COLOR}
        title={t("videos.title")}
        subtitle={t("videos.subtitle")}
      />
      <div className="mt-4">
        {tree.length === 0 ? (
          <ComingSoonState icon={VideoIcon} />
        ) : filteredRoots.length === 0 ? (
          <EmptyState icon={Folder} title={t("videos.empty")} description={t("videos.emptyDesc")} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRoots.map((node, idx) => renderFolderCard(node, idx))}
          </div>
        )}
      </div>
    </div>
  );

  // Current drill-down level — branch folders show child folders only;
  // videos live at their leaf pack (no aggregated video dump at branch
  // levels, so a folder reads as an organizer, not a mixed listing).
  const levelChildren = currentFolder ? visibleChildren(currentFolder) : [];
  const parentLabel = pathNodes.length > 1 ? (pathNodes.at(-2)?.title ?? t("videos.allFolders")) : t("videos.allFolders");
  const subpageView = currentFolder ? (
    <div className="osler-page__inner--wide">
      <button
        type="button"
        onClick={popFolder}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
      >
        <ArrowLeft className={cn("size-3.5", rtl && "rtl-flip-x")} />
        {parentLabel}
      </button>
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="size-12 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: `color-mix(in oklch, ${VIDEO_COLOR} 12%, transparent)`, color: VIDEO_COLOR }}
          >
            {currentFolder.items.length > 0 ? <Folder className="size-6" /> : <VideoIcon className="size-6" />}
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight truncate">{currentFolder.title}</h1>
            <p className="text-sm text-muted-foreground">
              {currentFolder.items.length > 0 ? (
                <>
                  {t("videos.subfolders", { n: levelChildren.length })}
                  {" · "}
                  {t("videos.videosCount", { n: totalVideos(currentFolder) })}
                </>
              ) : (
                t("videos.videosCount", { n: totalVideos(currentFolder) })
              )}
            </p>
          </div>
        </div>
        {renderLevelActions(currentFolder)}
      </div>
      {levelChildren.length > 0 && (
        <div className="mt-6">
          <SectionHeading icon={Folder}>{t("videos.folders")}</SectionHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {levelChildren.map((node, idx) => renderFolderCard(node, idx))}
          </div>
        </div>
      )}
      {levelChildren.length === 0 && (
        <div className="mt-6">
          <SectionHeading icon={VideoIcon}>{t("videos.allVideos")}</SectionHeading>
          {folderVideos.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 mb-3">
              {/* Folder watch progress */}
              <div className="flex items-center gap-2 flex-1 min-w-44">
                <MetricBar
                  value={watchedInFolder}
                  max={folderVideos.length}
                  color="success"
                  label={t("videos.watchedCount", { watched: watchedInFolder, total: folderVideos.length })}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                  {t("videos.watchedCount", { watched: watchedInFolder, total: folderVideos.length })}
                </span>
              </div>
              {/* Watch-history filter pills */}
              <div className="flex items-center gap-1.5" role="tablist" aria-label={t("videos.allVideos")}>
                {([
                  ["all", t("videos.all")],
                  ["unwatched", t("videos.unwatched")],
                  ["watched", t("videos.watched")],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={watchFilter === mode}
                    onClick={() => selectWatchFilter(mode)}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                      watchFilter === mode
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/60 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {renderVideoGrid()}
        </div>
      )}
    </div>
  ) : null;

  // The player renders as an overlay above the hub (its root is
  // `fixed inset-0 z-50`) so the hub stays mounted while watching —
  // unmounting/remounting it on every open/close replays every card
  // entrance animation (flicker).
  return (
    <>
      <motion.div {...swipeDismissProps} className="h-full">
        <NavigationStack
          className="h-full"
          homeClassName="osler-page"
          subpageClassName="osler-page"
          rtl={rtl}
          home={homeView}
          subpage={subpageView}
          onBack={() => setFolderUidPath((p) => p.slice(0, -1))}
        />
      </motion.div>

      {activeVideo && (
        <VideoPlayerView
          video={activeVideo}
          playlist={playlist}
          onExit={closeVideo}
          onNext={playNext}
          onPrev={playPrev}
          onSelectFromPlaylist={(v) => openVideo({ ...v, nodeUid: activeVideo.nodeUid, nodePath: activeVideo.nodePath })}
          onOpenArticle={onOpenArticle}
        />
      )}
    </>
  );
}

/* ── Video thumbnail ─────────────────────────────────────────────────
 *
 * YouTube thumbnail candidates, largest first — when one variant 404s
 * the next is tried instead of leaving a broken tile. Above-fold cards
 * load eagerly; the rest stay lazy.
 */
const YT_THUMB_VARIANTS = ["hqdefault", "mqdefault", "default"] as const;

function thumbCandidates(video: VideoResource): string[] {
  if (video.thumbnail) return [video.thumbnail];
  const src = video.source;
  if (src?.type === "youtube" && src.id) {
    return YT_THUMB_VARIANTS.map((v) => `https://i.ytimg.com/vi/${src.id}/${v}.jpg`);
  }
  return [];
}

function VideoThumb({ video, eager, alt, iconClass }: {
  video: VideoResource;
  eager?: boolean;
  alt: string;
  iconClass?: string;
}) {
  const srcs = React.useMemo(() => thumbCandidates(video), [video]);
  const [failed, setFailed] = React.useState(0);
  const src = failed < srcs.length ? srcs[failed] : null;
  if (!src) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
        <VideoIcon className={iconClass ?? "size-8"} />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed((n) => n + 1)}
      className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}

/* ── Video Player View ─────────────────────────────────────────────── */

interface PlayerViewProps {
  video: VideoResource & { nodeUid?: string; nodePath?: string };
  playlist: VideoResource[];
  onExit: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSelectFromPlaylist: (v: VideoResource) => void;
  onOpenArticle?: (id: string) => void;
}

function VideoPlayerView({
  video,
  playlist,
  onExit,
  onNext,
  onPrev,
  onSelectFromPlaylist,
  onOpenArticle,
}: PlayerViewProps) {
  const { t, rtl } = useI18n();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const plyrRef = React.useRef<any>(null);
  const youtubeRef = React.useRef<any>(null);

  const [isFullscreen, setIsFullscreen] = React.useState(false);
  // YouTube embed is the default player; Invidious is strictly opt-in —
  // only a stored explicit choice ("video-alt-host" === "true") selects
  // it. The choice persists across videos and sessions.
  const [invidiousMode, setInvidiousMode] = React.useState<boolean>(() => cachedAltHost ?? false);
  const [invidiousStart, setInvidiousStart] = React.useState<number | undefined>(undefined);
  const [showFullDescription, setShowFullDescription] = React.useState(false);
  const [autoplay, setAutoplay] = React.useState<boolean>(() => cachedAutoplay ?? true);
  // Persisted playback speed (default 1×) — applied to whichever backend
  // boots (YouTube IFrame or Plyr) and adjustable live via the quick
  // control, presets, or the ] / [ / \ shortcuts.
  const [playbackRate, setPlaybackRateState] = React.useState<number>(() => cachedSpeed ?? 1);
  // Gates player boot until the stored prefs resolve, so the first (and
  // only) boot uses the right player. Seeded from the module cache above,
  // so only the first open per page load waits (a microtask or two — the
  // stage is a black box meanwhile, indistinguishable from player load).
  const [prefsReady, setPrefsReady] = React.useState<boolean>(() => cachedAltHost !== null && cachedAutoplay !== null && cachedSpeed !== null);

  // ── Speed flash: every open / hop visibly re-asserts the speed so
  // the user always knows what rate the fresh embed actually plays at.
  // The badge shows the read-back value (or the embed's actual rate if
  // it refused the preset) — never an optimistic guess.
  const [pinnedFlash, setPinnedFlash] = React.useState<{ rate: number; key: number } | null>(null);
  const onPinnedRef = React.useRef((r: number) => {});
  onPinnedRef.current = (r: number) => setPinnedFlash({ rate: r, key: Date.now() });
  React.useEffect(() => {
    if (!pinnedFlash) return;
    const t = window.setTimeout(() => setPinnedFlash(null), 1500);
    return () => window.clearTimeout(t);
  }, [pinnedFlash]);

  // Latest auto-advance behavior for the player event callbacks (which are
  // bound once at player init and would otherwise capture stale props).
  const autoAdvanceRef = React.useRef<() => void>(() => {});
  // Latest rate for the same reason — the YT onReady closure and the Plyr
  // init both read through this instead of a stale render capture.
  // `rateRef` is the persisted *desired* speed (full 0.25–4× range);
  // `effRateRef` is what the mounted backend can actually play
  // (min(desired, backend cap)) — the cap is applied, never stored, so a
  // 3× direct-file speed survives a YouTube detour instead of being
  // rewritten to 2× on open.
  const rateRef = React.useRef(playbackRate);
  rateRef.current = playbackRate;
  const effRateRef = React.useRef(playbackRate);
  autoAdvanceRef.current = () => {
    if (autoplay) onNext();
  };

  React.useEffect(() => {
    if (cachedAltHost !== null && cachedAutoplay !== null && cachedSpeed !== null) return;
    let cancelled = false;
    // Never hold the player hostage on a wedged settings read — resolve
    // the gate on completion OR after a short fallback either way.
    const fallback = setTimeout(() => {
      if (!cancelled) {
        cachedAltHost ??= false;
        cachedAutoplay ??= true;
        cachedSpeed ??= 1;
        setPrefsReady(true);
      }
    }, 800);
    void Promise.all([
      settings.get("video-alt-host").then((val) => {
        if (cancelled) return;
        cachedAltHost = val == null ? false : val === "true";
        setInvidiousMode(cachedAltHost);
      }),
      settings.get("video-autoplay").then((val) => {
        if (cancelled) return;
        cachedAutoplay = val == null ? true : val === "true";
        setAutoplay(cachedAutoplay);
      }),
      settings.get("video-speed").then((val) => {
        if (cancelled) return;
        cachedSpeed = parseStoredRate(val);
        setPlaybackRateState(cachedSpeed);
      }),
    ])
      .catch(() => {})
      .finally(() => {
        clearTimeout(fallback);
        if (!cancelled) {
          cachedAltHost ??= false;
          cachedAutoplay ??= true;
          cachedSpeed ??= 1;
          setPrefsReady(true);
        }
      });
    return () => {
      cancelled = true;
      clearTimeout(fallback);
    };
  }, []);

  const toggleAutoplay = () => {
    haptic("selection");
    const next = !autoplay;
    cachedAutoplay = next;
    setAutoplay(next);
    void settings.set("video-autoplay", String(next));
  };

  const switchPlayer = () => {
    haptic("selection");
    setInvidiousStart(undefined);
    const next = !invidiousMode;
    cachedAltHost = next;
    setInvidiousMode(next);
    void settings.set("video-alt-host", String(next));
  };

  const isYouTube = videoStreamKind(video) === "youtube";
  const videoId = isYouTube ? video.source.id : undefined;
  // Direct-file URL for mp4/hls sources — absolute `url` as-is, `r2` keys
  // resolved against the video's own pack folder (cloud → Worker Range
  // endpoint, local → bundled files). YouTube plays via the IFrame API.
  const streamUrl = isYouTube ? null : resolveVideoUrl(video, video.nodePath);
  // Watch history for this video (synced store — marks from any device).
  const watchedIds = useVideoWatch();
  const isWatched = watchedIds.has(video.id);

  const toggleWatched = React.useCallback(() => {
    haptic("selection");
    void videoWatch.toggle(video.id);
  }, [video.id]);

  // Mark-on-finish shared by both player backends. The effect closures below
  // bind per video (streamUrl/videoId change per video), so the captured id
  // is always the video that just ended.
  const markFinished = React.useCallback(() => {
    void videoProgress.clear(video.id);
    void videoWatch.mark(video.id).then((changed) => {
      if (changed) haptic("success");
    });
  }, [video.id]);

  // ── Resume position (local-only videoProgress store) ──
  // Offset to seek to on boot, or undefined for a fresh/finished video.
  // Memoized per video so mid-playback saves never re-trigger a seek.
  const resumeAt = React.useMemo(() => resumeFromEntry(videoProgress.get(video.id)), [video.id]);
  // Latest known position (both backends keep it fresh); flushed on
  // unmount / playlist hop so quitting mid-video resumes where the user
  // left off. Reset per video (declared after the flush effect so the old
  // video's position is written before the ref is recycled).
  const posRef = React.useRef<{ t: number; d?: number }>({ t: 0 });
  const lastSaveRef = React.useRef(0);
  const writeProgress = React.useCallback((t: number, d?: number, force = false) => {
    if (!Number.isFinite(t) || t < 0) return;
    const dur = Number.isFinite(d) ? (d as number) : undefined;
    posRef.current = { t, ...(dur != null && dur > 0 ? { d: dur } : {}) };
    // Inside the finish margin counts as watched-through: drop the row so
    // the next open starts at 0 instead of the credits.
    if (dur != null && dur > 0 && t >= dur - FINISH_MARGIN_S) {
      void videoProgress.clear(video.id);
      return;
    }
    if (t < RESUME_MIN_S) {
      // No rows for the first seconds — but drop a stale row when the user
      // seeks back to the start.
      if (videoProgress.get(video.id)) void videoProgress.clear(video.id);
      return;
    }
    if (!force) {
      const now = Date.now();
      if (now - lastSaveRef.current < PROGRESS_SAVE_MS) return;
      lastSaveRef.current = now;
    }
    void videoProgress.save(video.id, t, dur);
  }, [video.id]);

  // Flush the latest position when leaving the video (close, playlist hop,
  // unmount) — the throttled tick alone would lose the last seconds.
  React.useEffect(() => () => {
    const { t, d } = posRef.current;
    writeProgress(t, d, true);
  }, [writeProgress]);
  React.useEffect(() => {
    // Seed from the resume point so a close before the first tick keeps it
    // instead of flushing a zero over the saved row.
    posRef.current = { t: resumeAt ?? 0 };
    lastSaveRef.current = 0;
  }, [video.id, resumeAt]);

  // ── Playback speed (shared by the YouTube + Plyr backends) ──
  // `playbackRate` is the persisted *desired* speed (full 0.25–4× range);
  // `effectiveRate` is what the mounted backend can play (the YouTube
  // backend caps at 2×). The cap is applied, never stored — opening a
  // YouTube video must not rewrite a saved 3× down to 2×. Steps move from
  // the effective rate so taps always do something audible; presets set
  // the desired rate directly (each list only offers playable values).
  // The alt-host (Invidious) iframe exposes no JS API, so live stepping is
  // disabled there — the effective rate is still passed as `&speed=` when
  // its embed (re)loads.
  const maxRate = isYouTube && !invidiousMode ? YT_MAX_RATE : SPEED_MAX;
  const maxRateRef = React.useRef(maxRate);
  maxRateRef.current = maxRate;
  const effectiveRate = Math.min(playbackRate, maxRate);
  effRateRef.current = effectiveRate;
  const applyRate = React.useCallback((next: number, silent = false) => {
    const clamped = clampRate(next);
    if (clamped === rateRef.current) return;
    if (!silent) haptic("selection");
    cachedSpeed = clamped;
    rateRef.current = clamped;
    setPlaybackRateState(clamped);
    void settings.set("video-speed", String(clamped));
    const effective = Math.min(clamped, maxRateRef.current);
    // Eager update so the boot pin-retry loop (below) converges to the
    // newest choice instead of a stale render capture.
    effRateRef.current = effective;
    const yt = youtubeRef.current;
    if (yt && typeof yt.setPlaybackRate === "function") {
      try {
        yt.setPlaybackRate(effective);
      } catch {
        /* player torn down mid-flight */
      }
    }
    const plyr = plyrRef.current;
    if (plyr) {
      try {
        plyr.speed = effective;
      } catch {
        /* noop */
      }
    }
  }, []);

  const stepRate = React.useCallback((delta: number) => {
    if (invidiousMode) return;
    applyRate(effRateRef.current + delta);
  }, [applyRate, invidiousMode]);

  const resetRate = React.useCallback(() => {
    if (invidiousMode) return;
    applyRate(1);
  }, [applyRate, invidiousMode]);

  // A chapter jump stamps invidiousStart — on video change re-seed it from
  // the saved resume position (Invidious has no JS seek API, so the offset
  // rides the embed's `&start=` param) instead of inheriting the old stamp.
  React.useEffect(() => {
    const saved = resumeFromEntry(videoProgress.get(video.id));
    setInvidiousStart(saved != null ? Math.floor(saved) : undefined);
  }, [video.id, videoId]);

  // ── Jump to section helper ──
  const handleJumpToSection = (time: number) => {
    haptic("selection");
    if (invidiousMode && videoId) {
      // Invidious embeds expose no JS API — reload the embed at the target time.
      setInvidiousStart(Math.floor(time));
    } else if (isYouTube && !invidiousMode && youtubeRef.current) {
      try {
        if (typeof youtubeRef.current.seekTo === "function") {
          youtubeRef.current.seekTo(time, true);
          youtubeRef.current.playVideo();
        }
      } catch (e) {
        console.error("Failed seeking YouTube player:", e);
      }
    } else if (plyrRef.current) {
      plyrRef.current.currentTime = time;
      void plyrRef.current.play();
    }
  };

  // ── Initialise player: YouTube IFrame API or Plyr ──
  // Gated on prefsReady so the single boot uses the stored player choice
  // instead of booting the default and rebooting when prefs land.
  React.useEffect(() => {
    if (!prefsReady || !containerRef.current || invidiousMode) return;

    containerRef.current.innerHTML = "";

    let destroyed = false;

    // Helper to init Plyr with a given video element — lazy-loads the heavy
    // `plyr` dep only when a non-YouTube video is actually played, keeping it
    // out of the main bundle for users who never open the Videos hub.
    async function initPlyr(el: HTMLVideoElement) {
      // plyr's types are `export =` + `export default`; TS 7 resolves the
      // dynamic-import namespace to the class itself, so fall back to it
      // when `.default` is absent (the ESM bundle always has one).
      const mod = await import("plyr");
      const Plyr = (mod as { default?: unknown }).default ?? mod;
      const p = new (Plyr as any)(el, {
        controls: [
          "play-large", "play", "progress", "current-time",
          "duration", "mute", "volume", "settings", "pip", "fullscreen",
        ],
        settings: ["speed"],
        speed: { selected: effRateRef.current, options: PLAYBACK_RATES },
        keyboard: { focused: true, global: false },
        tooltips: { controls: true, seek: true },
        seekTime: 10,
        disableContextMenu: true,
        resetOnEnd: false,
        autoplay: true,
      });
      p.on("ended", () => {
        markFinished();
        autoAdvanceRef.current();
      });
      try {
        p.speed = effRateRef.current;
      } catch {
        /* pre-ready player */
      }
      plyrRef.current = p;
      requestAnimationFrame(() => {
        const el = containerRef.current?.querySelector<HTMLElement>(".plyr");
        el?.focus();
      });
      return p;
    }

    if (isYouTube && videoId) {
      const rootId = `yt-${videoId}`;
      const root = document.createElement("div");
      root.id = rootId;
      root.style.width = "100%";
      root.style.height = "100%";
      containerRef.current.appendChild(root);

      let player: any = null;
      // Pin the persisted speed with read-back verification. A single
      // onReady-time setPlaybackRate races the embed (rates unavailable
      // or reset to 1× while cueing), so a preset 2× silently drops on
      // fresh boots while mid-playback changes work fine. pinRate
      // re-asserts until getPlaybackRate() reads back the desired value
      // (bounded attempts), then never touches the player again — so a
      // manual change via YouTube's own menu afterwards is not stomped.
      // Every pin reports the verified (or actual, on refusal) rate
      // through onPinnedRef so the badge tells the user the truth.
      // Fresh closure per effect run, so every open / next-video hop
      // starts unverified and re-pins.
      let rateVerified = false;
      let pinTimer = 0;
      const PIN_ATTEMPTS = 10;
      function pinRate(attempt = 0) {
        if (destroyed || rateVerified) return;
        const want = effRateRef.current;
        let have: number | undefined;
        try {
          have =
            player && typeof player.getPlaybackRate === "function"
              ? (player.getPlaybackRate() as number)
              : undefined;
        } catch {
          have = undefined;
        }
        if (typeof have === "number" && Math.abs(have - want) < 0.01) {
          rateVerified = true;
          try {
            onPinnedRef.current(want);
          } catch {
            /* unmounted */
          }
          return;
        }
        try {
          if (player && typeof player.setPlaybackRate === "function") {
            player.setPlaybackRate(want);
          }
        } catch {
          /* pre-ready player */
        }
        if (attempt >= PIN_ATTEMPTS) {
          // The embed refused the preset — flash its actual rate so the
          // user sees what is really playing instead of a stale badge.
          if (typeof have === "number") {
            try {
              onPinnedRef.current(have);
            } catch {
              /* unmounted */
            }
          }
          return;
        }
        window.clearTimeout(pinTimer);
        pinTimer = window.setTimeout(() => pinRate(attempt + 1), 600);
      }
      // Resume offset captured for this boot (resumeAt is memoized per
      // video, so mid-playback saves can't move it under us).
      const startAt = resumeAt;
      // Throttled position poll — the IFrame API has no timeupdate event.
      const progressTimer = window.setInterval(() => {
        try {
          if (player && typeof player.getCurrentTime === "function") {
            writeProgress(
              player.getCurrentTime(),
              typeof player.getDuration === "function" ? player.getDuration() : undefined,
            );
          }
        } catch {
          /* tearing down */
        }
      }, PROGRESS_SAVE_MS);

      function boot() {
        if (destroyed) return;
        const YT = (window as any).YT;
        if (!YT?.Player) {
          const prev = (window as any).onYouTubeIframeAPIReady;
          (window as any).onYouTubeIframeAPIReady = () => {
            if (prev) prev();
            (window as any).onYouTubeIframeAPIReady = null;
            boot();
          };
          if (!prev) {
            const s = document.createElement("script");
            s.src = "https://www.youtube.com/iframe_api";
            document.head.appendChild(s);
          }
          return;
        }

        player = new YT.Player(rootId, {
          height: "100%",
          width: "100%",
          videoId,
          playerVars: {
            autoplay: 1,
            controls: 1,
            disablekb: 0,
            enablejsapi: 1,
            iv_load_policy: 3,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            origin: window.location.origin,
            ...(startAt != null ? { start: Math.floor(startAt) } : {}),
          },
          events: {
            onReady: () => {
              if (destroyed) return;
              pinRate();
              // playerVars.start cues close; seekTo lands exactly.
              if (startAt != null) {
                try {
                  player.seekTo(startAt, true);
                } catch {
                  /* seek pre-ready */
                }
              }
              player.playVideo();
            },
            onStateChange: (event: { data: number }) => {
              // 0 === YT.PlayerState.ENDED
              if (event.data === 0) {
                markFinished();
                autoAdvanceRef.current();
              } else if (event.data === 1) {
                // 1 === PLAYING — (re)pin the persisted speed. Covers the
                // onReady race and any silent drop on fresh opens and
                // next-video hops; pinRate stops once verified.
                pinRate();
              } else if (event.data === 2) {
                // 2 === PAUSED — flush so closing a paused video keeps it.
                try {
                  writeProgress(
                    player.getCurrentTime(),
                    typeof player.getDuration === "function" ? player.getDuration() : undefined,
                    true,
                  );
                } catch {
                  /* tearing down */
                }
              }
            },
          },
        });

        youtubeRef.current = player;
      }

      boot();

      return () => {
        destroyed = true;
        window.clearInterval(progressTimer);
        window.clearTimeout(pinTimer);
        if (player && typeof player.destroy === "function") {
          try { player.destroy(); } catch { /* noop */ }
        }
        youtubeRef.current = null;
      };
    }

    if (!isYouTube && streamUrl) {
      const videoEl = document.createElement("video");
      videoEl.src = streamUrl;
      videoEl.playsInline = true;
      // Resume + tracking on the underlying media element (Plyr wraps it,
      // so native timeupdate/pause still fire). Listeners attach before
      // init so no early seconds are missed.
      const onTimeUpdate = () => writeProgress(videoEl.currentTime, videoEl.duration);
      const onPauseFlush = () => writeProgress(videoEl.currentTime, videoEl.duration, true);
      videoEl.addEventListener("timeupdate", onTimeUpdate);
      videoEl.addEventListener("pause", onPauseFlush);
      if (resumeAt != null) {
        const seekStart = () => {
          try {
            videoEl.currentTime = resumeAt;
          } catch {
            /* metadata not ready */
          }
        };
        if (videoEl.readyState >= 1) seekStart();
        else videoEl.addEventListener("loadedmetadata", seekStart, { once: true });
      }
      containerRef.current.appendChild(videoEl);
      let plyrInstance: any = null;
      let cancelled = false;
      void initPlyr(videoEl).then((p) => {
        if (cancelled || destroyed) {
          try { p.destroy(); } catch {}
          return;
        }
        plyrInstance = p;
      });
      return () => {
        cancelled = true;
        videoEl.removeEventListener("timeupdate", onTimeUpdate);
        videoEl.removeEventListener("pause", onPauseFlush);
        if (plyrInstance) {
          try { plyrInstance.destroy(); } catch {}
        }
        plyrRef.current = null;
      };
    }
  }, [isYouTube, videoId, streamUrl, invidiousMode, prefsReady, markFinished, resumeAt, writeProgress]);

  // ── Fullscreen tracking ──
  React.useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // ── Keyboard shortcuts ──
  useShortcutListener(
    (actionId, _e) => {
      switch (actionId) {
        case "videos.exit":
          if (!document.fullscreenElement) onExit();
          break;
        case "videos.next":
          onNext?.();
          break;
        case "videos.prev":
          onPrev?.();
          break;
        case "videos.fullscreen":
          if (isYouTube && youtubeRef.current) {
            const iframe = youtubeRef.current.getIframe();
            if (iframe?.requestFullscreen) void iframe.requestFullscreen();
          } else {
            void plyrRef.current?.fullscreen.toggle();
          }
          break;
        case "videos.mute":
          if (isYouTube && youtubeRef.current) {
            youtubeRef.current[youtubeRef.current.isMuted() ? "unMute" : "mute"]();
          } else if (plyrRef.current) {
            plyrRef.current.muted = !plyrRef.current.muted;
          }
          break;
        case "videos.speedUp":
          stepRate(SPEED_STEP);
          break;
        case "videos.speedDown":
          stepRate(-SPEED_STEP);
          break;
        case "videos.speedReset":
          resetRate();
          break;
      }
    },
    { ignoreInputs: true },
  );

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col safe-pb safe-px overflow-hidden">
      {/* Outer owns side + bottom insets only: the header grows its own
          height by the top inset, so safe-screen here would double-count
          the top and crush the bar on notched iPhones. */}
      {/* Top bar (height grows with the notch; content row stays 48px) */}
      <header className="h-[calc(3rem+env(safe-area-inset-top,0px))] flex items-center px-2 sm:px-4 gap-2 shrink-0 border-b border-border bg-card/60 backdrop-blur-md safe-pt">
        <button
          onClick={() => { haptic('light'); onExit(); }}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors osler-touch-target"
          title={t("videos.backToVideos")}
        >
          <ArrowLeft className={cn("size-4", rtl && "rtl-flip-x")} />
          <span className="hidden sm:inline font-medium">{t("videos.backToVideos")}</span>
        </button>

        <div className="h-5 w-px bg-border/60 hidden sm:block" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {video.specialty && (
              <>
                <span className="font-semibold text-foreground truncate">{video.specialty}</span>
                <span className="opacity-50">·</span>
              </>
            )}
            <span className="truncate">{video.title}</span>
          </div>
        </div>

        {onPrev && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { haptic("selection"); onPrev(); }}
            title={t("videos.prevTitle")}
          >
            <ChevronLeft className={cn("size-4", rtl && "rtl-flip-x")} />
          </Button>
        )}
        {onNext && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { haptic("selection"); onNext(); }}
            title={t("videos.nextTitle")}
          >
            <ChevronRight className={cn("size-4", rtl && "rtl-flip-x")} />
          </Button>
        )}
        <PlayerWatchedToggle
          watched={isWatched}
          onToggle={toggleWatched}
          labelClassName="hidden md:inline"
          className="hidden sm:flex"
        />
        {playlist.length > 1 && (
          <PlayerAutoplayToggle
            autoplay={autoplay}
            onToggle={toggleAutoplay}
            labelClassName="hidden md:inline"
            className="hidden sm:flex"
          />
        )}
        <PlayerSpeedControl
          rate={effectiveRate}
          presets={isYouTube ? YT_PLAYBACK_RATES : PLAYBACK_RATES}
          capNote={isYouTube ? t("videos.youtubeSpeedCap") : undefined}
          onStep={stepRate}
          onReset={resetRate}
          onPreset={applyRate}
          disabled={invidiousMode}
          disabledTitle={t("videos.speedStandardOnly")}
          className="hidden sm:flex"
        />
        {isYouTube && INVIDIOUS_HOST && (
          <PlayerSourceToggle
            invidiousMode={invidiousMode}
            onToggle={switchPlayer}
            labelClassName="hidden md:inline"
            className="hidden sm:flex"
          />
        )}
      </header>

      {/* Body: Main stage (Player + Metadata) + Right Sidebar (Up Next Playlist & Chapters).
          Phones get ONE scroll surface (the Body) so nested scrollers can't
          trap touches and leave Up Next covering the player; the player
          itself sticks to the top while the list scrolls underneath. */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        {/* Main Stage Column — flows with the outer scroller on phones,
            owns its own scroll on desktop. */}
        <div className="flex-1 min-w-0 flex flex-col lg:overflow-y-auto lg:h-full p-3 sm:p-4 lg:p-6 space-y-4">
          {/* Sticky player on phones — pinned while Up Next scrolls past. */}
          <div className="sticky top-0 z-10 -mx-3 px-3 pt-3 pb-2 bg-background sm:-mx-4 sm:px-4 lg:static lg:mx-0 lg:px-0 lg:pt-0 lg:pb-0 lg:bg-transparent lg:z-auto">
          {/* Video Player Container — while prefs resolve the stage stays a
              black box (indistinguishable from player load) instead of
              mounting the default player and swapping it a beat later. */}
          <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-black shadow-e3 border border-border shrink-0">
            {!prefsReady ? null : invidiousMode && videoId ? (
              <iframe
                src={`https://${INVIDIOUS_HOST}/embed/${videoId}?autoplay=1${invidiousStart != null ? `&start=${invidiousStart}` : ""}${effectiveRate !== 1 ? `&speed=${effectiveRate}` : ""}`}
                className="absolute inset-0 w-full h-full"
                style={{ border: "none" }}
                allow="autoplay; encrypted-media; fullscreen"
                allowFullScreen
              />
            ) : (
              <div ref={containerRef} className="absolute inset-0 w-full h-full" />
            )}
            {/* Speed badge — flashes the verified playback rate on every
                open / hop (numerals only, no i18n needed). Doubles as proof
                of which rate the fresh embed actually plays at. */}
            <AnimatePresence>
              {pinnedFlash && (
                <motion.div
                  key={pinnedFlash.key}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.22 }}
                  className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
                  aria-hidden
                >
                  <span className="rounded-full bg-black/70 px-4 py-2 text-2xl font-bold tabular-nums text-white">
                    {pinnedFlash.rate}×
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          </div>

          {/* YouTube-like Metadata Header */}
          <div className="space-y-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground leading-snug">
              {video.title}
            </h1>

            {/* Instructor / Specialty Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary text-sm shrink-0">
                  {video.instructor ? video.instructor.charAt(0).toUpperCase() : <VideoIcon className="size-5" />}
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {video.instructor || video.specialty || "Osler Medical"}
                  </div>
                  {video.specialty && (
                    <div className="text-xs text-muted-foreground">{video.specialty}</div>
                  )}
                </div>
              </div>

              {/* Jump to section quick pill row if chapters exist */}
              {video.chapters && video.chapters.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto py-1 max-w-full no-scrollbar">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider shrink-0 me-1">
                    {t("videos.chapters")}:
                  </span>
                  {video.chapters.map((ch, i) => (
                    <button
                      key={i}
                      onClick={() => handleJumpToSection(ch.time)}
                      className="px-2.5 py-1 rounded-full text-xs font-medium bg-muted/80 hover:bg-primary/15 hover:text-primary border border-border transition-colors shrink-0 flex items-center gap-1.5"
                    >
                      <Clock className="size-3 text-muted-foreground" />
                      <span>{ch.title}</span>
                      <span className="text-[11px] opacity-70 tabular-nums font-mono">
                        ({fmtTime(ch.time)})
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Description box */}
            {video.description && (
              <div className="rounded-xl bg-card border border-border p-4 space-y-2 text-sm leading-relaxed">
                <div className={cn(!showFullDescription && "line-clamp-3")}>
                  {video.description}
                </div>
                {video.description.length > 120 && (
                  <button
                    onClick={() => setShowFullDescription((s) => !s)}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    {showFullDescription ? t("videos.showLess") : t("videos.showMore")}
                  </button>
                )}
              </div>
            )}

            {/* Tags & Related Articles */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {video.tags?.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-muted text-muted-foreground text-xs font-medium"
                >
                  <Tag className="size-3" />
                  {tag}
                </span>
              ))}

              {video.relatedArticles && video.relatedArticles.length > 0 && onOpenArticle && (
                <div className="flex items-center gap-1.5 ms-auto">
                  {video.relatedArticles.map((id) => (
                    <button
                      key={id}
                      onClick={() => onOpenArticle(id)}
                      className="px-2.5 py-1 rounded-md bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors inline-flex items-center gap-1.5"
                    >
                      <BookOpen className="size-3.5" />
                      <span>{id.replace(/\.md$/, "").replace(/-/g, " ")}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Sidebar: Up Next Playlist — natural height on phones (the
            Body scrolls), internally scrolled fixed column on desktop. */}
        <aside className="w-full lg:w-96 shrink-0 border-t lg:border-t-0 lg:border-s border-border bg-card flex flex-col lg:h-full lg:overflow-hidden">
          <div className="p-3 sm:p-4 border-b border-border">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-tight uppercase text-muted-foreground flex items-center gap-2">
                <ListVideo className="size-4 text-primary" />
                {t("videos.upNext")}
              </h3>
              <span className="text-xs font-mono text-muted-foreground px-2 py-0.5 rounded-full bg-muted">
                {t("videos.videosCount", { n: playlist.length })}
              </span>
            </div>
            {/* Phone-only playback prefs — the top bar only fits back +
                title + prev/next at 390px, so autoplay, the watched toggle,
                and the player switch live here next to the playlist. */}
            <div className="flex sm:hidden items-center gap-2 mt-2.5">
              <PlayerWatchedToggle
                watched={isWatched}
                onToggle={toggleWatched}
                className="h-9"
              />
              {playlist.length > 1 && (
                <PlayerAutoplayToggle
                  autoplay={autoplay}
                  onToggle={toggleAutoplay}
                  className="h-9"
                />
              )}
              <PlayerSpeedControl
                rate={effectiveRate}
                presets={isYouTube ? YT_PLAYBACK_RATES : PLAYBACK_RATES}
                capNote={isYouTube ? t("videos.youtubeSpeedCap") : undefined}
                onStep={stepRate}
                onReset={resetRate}
                onPreset={applyRate}
                disabled={invidiousMode}
                disabledTitle={t("videos.speedStandardOnly")}
                className="h-9"
              />
              {isYouTube && INVIDIOUS_HOST && (
                <PlayerSourceToggle
                  invidiousMode={invidiousMode}
                  onToggle={switchPlayer}
                  className="h-9"
                />
              )}
            </div>
          </div>

          <div className="p-2 space-y-2 lg:flex-1 lg:overflow-y-auto pb-[min(max(env(safe-area-inset-bottom,0px),1rem),2.5rem)] lg:pb-2">
            {playlist.map((v) => {
              const isActive = v.id === video.id;
              return (
                <button
                  key={v.id}
                  onClick={() => {
                    haptic("light");
                    onSelectFromPlaylist(v);
                  }}
                  className={cn(
                    "w-full text-start flex items-start gap-3 p-2 rounded-xl border transition-all duration-150 group",
                    isActive
                      ? "bg-primary/10 border-primary/40 shadow-e1"
                      : "bg-card/60 hover:bg-card border-border hover:border-border"
                  )}
                >
                  {/* Thumbnail Box */}
                  <div className="relative w-32 aspect-video shrink-0 rounded-lg overflow-hidden bg-muted border border-border">
                    <VideoThumb video={v} alt="" iconClass="size-6" />
                    {isActive ? (
                      <div className="absolute inset-0 bg-primary/40 backdrop-blur-[1px] flex items-center justify-center">
                        <Play className="size-5 text-white fill-white" />
                      </div>
                    ) : v.duration != null ? (
                      <div className="absolute bottom-1 end-1 px-1 py-0.5 rounded text-[11px] font-mono font-medium bg-black/75 text-white">
                        {formatDuration(v.duration)}
                      </div>
                    ) : null}
                  </div>

                  {/* Video Meta */}
                  <div className="flex-1 min-w-0 pt-0.5">
                    <h4 className={cn("text-xs font-semibold line-clamp-2 leading-snug", isActive ? "text-primary" : "text-foreground group-hover:text-primary transition-colors")}>
                      {v.title}
                    </h4>
                    {v.instructor && (
                      <p className="text-[11px] text-muted-foreground mt-1 truncate">
                        {v.instructor}
                      </p>
                    )}
                    {v.specialty && (
                      <span className="inline-block mt-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {v.specialty}
                      </span>
                    )}
                  </div>
                  {/* Watched state — hidden on the active row (the player
                      header toggle already shows it there). */}
                  {!isActive && watchedIds.has(v.id) && (
                    <span title={t("videos.watched")} className="shrink-0 mt-1 text-success">
                      <CheckCircle2 className="size-4" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>
      </div>

    </div>
  );
}

/* ── Player toggle pills (top bar on sm+, Up Next header on phones) ── */

function PlayerWatchedToggle({
  watched,
  onToggle,
  labelClassName,
  className,
}: {
  watched: boolean;
  onToggle: () => void;
  labelClassName?: string;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={watched}
      className={cn(
        "px-2.5 h-8 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors border",
        watched
          ? "bg-success-soft text-success border-success/30"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60 border-border",
        className,
      )}
      title={watched ? t("videos.markUnwatched") : t("videos.markWatched")}
    >
      <CheckCircle2 className="size-3.5" />
      <span className={labelClassName}>{t("videos.watched")}</span>
    </button>
  );
}

function PlayerAutoplayToggle({
  autoplay,
  onToggle,
  labelClassName,
  className,
}: {
  autoplay: boolean;
  onToggle: () => void;
  labelClassName?: string;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={autoplay}
      className={cn(
        "px-2.5 h-8 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors border",
        autoplay
          ? "bg-primary/10 text-primary border-primary/30"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60 border-border",
        className,
      )}
      title={t("videos.autoplay")}
    >
      <ListVideo className="size-3.5" />
      <span className={labelClassName}>{t("videos.autoplay")}</span>
    </button>
  );
}

/* ── Playback-speed quick control (−0.1 / rate / +0.1 + presets) ──
 *
 * One control drives both live backends, but each backend declares its own
 * ceiling via `presets`: Plyr offers the full 0.25–4× range, YouTube only
 * up to 2× (with a footnote saying so — the menu never implies a rate the
 * player can't honor). The center badge shows the current rate and resets
 * to 1× on tap. Disabled (with an explanatory tooltip) in alt-host mode,
 * whose iframe exposes no live speed API — the saved rate is still passed
 * to its embed as `&speed=` on (re)load.
 */
function PlayerSpeedControl({
  rate,
  presets,
  capNote,
  onStep,
  onReset,
  onPreset,
  disabled,
  disabledTitle,
  className,
}: {
  rate: number;
  presets: number[];
  capNote?: string;
  onStep: (delta: number) => void;
  onReset: () => void;
  onPreset: (rate: number) => void;
  disabled?: boolean;
  disabledTitle?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const stepClass = cn(
    "size-7 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors",
    "disabled:pointer-events-none disabled:opacity-50",
  );
  return (
    <div
      role="group"
      aria-label={t("videos.speed")}
      title={disabled ? disabledTitle : undefined}
      className={cn(
        "flex items-center gap-0.5 rounded-md border border-border h-8 px-0.5 bg-card",
        disabled && "opacity-60",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onStep(-SPEED_STEP)}
        disabled={disabled}
        aria-label={t("videos.speedDown")}
        title={t("videos.speedDown")}
        className={stepClass}
      >
        <Minus className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onReset}
        disabled={disabled}
        aria-label={t("videos.speedReset")}
        title={t("videos.speedReset")}
        className="min-w-11 px-1 h-7 rounded text-xs font-bold tabular-nums text-foreground hover:bg-muted/60 transition-colors disabled:pointer-events-none disabled:opacity-50"
      >
        {fmtRate(rate)}
      </button>
      <button
        type="button"
        onClick={() => onStep(SPEED_STEP)}
        disabled={disabled}
        aria-label={t("videos.speedUp")}
        title={t("videos.speedUp")}
        className={stepClass}
      >
        <Plus className="size-3.5" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={t("videos.speedPresets")}
            title={t("videos.speedPresets")}
            className={cn(stepClass, "size-6")}
          >
            <ChevronDown className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" aria-label={t("videos.speed")}>
          {presets.map((preset) => (
            <DropdownMenuItem key={preset} onClick={() => onPreset(preset)}>
              {fmtRate(preset)}
              {Math.abs(preset - rate) < 0.001 && <Check className="size-3.5 ms-auto" />}
            </DropdownMenuItem>
          ))}
          {capNote && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="max-w-48 whitespace-normal text-xs font-normal leading-snug text-muted-foreground">
                {capNote}
              </DropdownMenuLabel>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function PlayerSourceToggle({
  invidiousMode,
  onToggle,
  labelClassName,
  className,
}: {
  invidiousMode: boolean;
  onToggle: () => void;
  labelClassName?: string;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={invidiousMode}
      className={cn(
        "px-2.5 h-8 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors border",
        invidiousMode
          ? "bg-primary text-primary-foreground border-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/60 border-border",
        className,
      )}
      title={t("videos.switchPlayer")}
    >
      <ExternalLink className="size-3.5" />
      <span className={labelClassName}>{invidiousMode ? t("videos.altHost") : t("videos.standard")}</span>
    </button>
  );
}

/* ── Tree helpers ──────────────────────────────────────────────────── */

function collectLeaves(node: ContentTreeNode): ContentTreeNode[] {
  if (node.items.length === 0) return [node];
  return node.items.flatMap(collectLeaves);
}
