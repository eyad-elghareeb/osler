"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PlayCircle,
  Play,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Clock,
  Tag,
  Loader2,
  Folder,
  Video as VideoIcon,
  ListVideo,
  X,
  BookOpen,
  ExternalLink,
  Sun,
} from "lucide-react";
import Plyr from "plyr";
import "plyr/dist/plyr.css";
import {
  loadVideoTree,
  loadNodeVideos,
  listAllVideos,
  resolveThumbnail,
  formatDuration,
} from "@/lib/osler/videos";
import type { VideoResource, ContentTreeNode } from "@/lib/osler/types";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { setImmersiveMode } from "./immersive-mode";
import { useShortcutListener } from "@/hooks/use-shortcuts";
import { useI18n } from "./i18n-provider";
import { ContentLangFilter } from "./qbank-studio";
import { FolderTreeNav } from "./folder-tree-nav";
import { ContentCacheButton } from "./content-cache-button";
import {
  acquireWakeLock,
  releaseWakeLock,
  isWakeLockSupported,
  haptic,
} from "@/lib/osler/native";
import { useSwipeBackDismiss } from "@/hooks/use-swipe-back-dismiss";

/* ── Constants ─────────────────────────────────────────────────────── */

const VIDEO_COLOR = "oklch(0.68 0.18 195)";

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** Alternative YouTube frontend host (set via NEXT_PUBLIC_INVIDIOUS_HOST in .env.local). */
const INVIDIOUS_HOST = process.env.NEXT_PUBLIC_INVIDIOUS_HOST;

/* ── Helpers ───────────────────────────────────────────────────────── */

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

/* ── Component ─────────────────────────────────────────────────────── */

import { useOslerRouter } from "@/lib/osler/navigation";

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
  const isMobile = useIsMobile();
  const { t, contentFilter, rtl } = useI18n();
  const { navigate } = useOslerRouter();

  const onNavigateBack = propOnNavigateBack || (() => navigate("learn"));
  const onOpenArticle = propOnOpenArticle || ((id: string) => navigate("library", { article: id }));

  const [tree, setTree] = React.useState<ContentTreeNode[]>([]);
  const [selectedNodeUid, setSelectedNodeUid] = React.useState<string | null>(null);
  const [folderVideos, setFolderVideos] = React.useState<VideoResource[]>([]);
  const [folderLoading, setFolderLoading] = React.useState(false);
  const [allVideos, setAllVideos] = React.useState<Array<VideoResource & { nodeUid: string; nodePath: string }>>([]);

  // The active video being played (or null = hub view).
  const [activeVideo, setActiveVideo] = React.useState<(VideoResource & { nodeUid: string; nodePath: string }) | null>(null);
  // Playlist: list of other videos in the same folder (for "up next").
  const [playlist, setPlaylist] = React.useState<VideoResource[]>([]);

  // Sidebar open/close for mobile.
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  // Swipe-back gesture to navigate to Learn hub (disabled when watching a video)
  const swipeDismissProps = useSwipeBackDismiss({
    onDismiss: () => {
      if (activeVideo) closeVideo();
      else onNavigateBack?.();
    },
    direction: "horizontal",
    rtl,
    disabled: !!activeVideo,
  });

  /* ── Load tree + all videos ── */
  React.useEffect(() => {
    (async () => {
      try {
        const [treeData, all] = await Promise.all([
          loadVideoTree(),
          listAllVideos(),
        ]);
        setTree(treeData);
        setAllVideos(all);
        // Auto-select the first leaf folder so the right pane isn't empty.
        const firstLeaf = findFirstLeaf(treeData);
        if (firstLeaf) setSelectedNodeUid(firstLeaf.uid);
      } catch (e) {
        console.error("Failed to load videos tree:", e);
      }
    })();
  }, []);

  // Load videos in the selected folder.
  React.useEffect(() => {
    if (!selectedNodeUid) {
      setFolderVideos([]);
      return;
    }
    const node = findNodeByUid(tree, selectedNodeUid);
    if (!node) {
      setFolderVideos([]);
      return;
    }
    setFolderLoading(true);
    const leaves = collectLeaves(node);
    Promise.all(leaves.map(loadNodeVideos))
      .then((arrays) => {
        const all = arrays.flat();
        // Apply content-language filter
        if (contentFilter !== "all") {
          setFolderVideos(all.filter((v) => (v.lang ?? "en") === contentFilter));
        } else {
          setFolderVideos(all);
        }
      })
      .catch((e) => {
        console.error("Failed to load folder videos:", e);
        setFolderVideos([]);
      })
      .finally(() => setFolderLoading(false));
  }, [selectedNodeUid, tree, contentFilter]);

  // Open initial video if provided.
  React.useEffect(() => {
    if (!initialVideoId || allVideos.length === 0) return;
    const found = allVideos.find((v) => v.id === initialVideoId);
    if (found) {
      openVideo(found);
    }
  }, [initialVideoId, allVideos]);

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

  /* ── Render: Player view ── */
  if (activeVideo) {
    return (
      <VideoPlayerView
        video={activeVideo}
        playlist={playlist}
        onExit={closeVideo}
        onNext={playNext}
        onPrev={playPrev}
        onSelectFromPlaylist={(v) => openVideo({ ...v, nodeUid: activeVideo.nodeUid, nodePath: activeVideo.nodePath })}
        onOpenArticle={onOpenArticle}
      />
    );
  }

  /* ── Render: Hub view ── */
  const selectedNode = selectedNodeUid ? findNodeByUid(tree, selectedNodeUid) : null;

  // Per-pack content URLs (for the offline download button).
  function collectPackUrls(node: ContentTreeNode): string[] {
    const ownBase = `/osler-content/videos/${node.path}`;
    const own = (node.files ?? []).map((f) => `${ownBase}${f}`);
    for (const img of node.images ?? []) own.push(`${ownBase}images/${img}`);
    if (node.items.length === 0) return own;
    const childUrls: string[] = [];
    for (const child of node.items) childUrls.push(...collectPackUrls(child));
    return [...own, ...childUrls];
  }

  return (
    <motion.div {...swipeDismissProps} className="osler-page">
      <div className="osler-page__inner--wide">
        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="osler-page-header--inline"
        >
          <div
            className="size-10 rounded-xl flex items-center justify-center shrink-0 border"
            style={{
              backgroundColor: `color-mix(in oklch, ${VIDEO_COLOR} 12%, transparent)`,
              borderColor: `color-mix(in oklch, ${VIDEO_COLOR} 30%, transparent)`,
              color: VIDEO_COLOR,
            }}
          >
            <PlayCircle className="size-5" />
          </div>
          <div>
            <h1 className="osler-page-header__title">
              {t("videos.title")}
            </h1>
            <p className="osler-page-header__subtitle">{t("videos.subtitle")}</p>
          </div>
        </motion.div>

        <ContentLangFilter />

        {/* Two-pane layout: folder tree (desktop) + video grid */}
        <div className="flex flex-col md:flex-row gap-4 mt-4">
          {/* Desktop sidebar: folder tree */}
          <aside className="hidden md:flex flex-col w-64 shrink-0">
            <div className="osler-card--compact">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2 px-2">
                <Folder className="size-3.5" />
                {t("videos.folders")}
              </div>
              <FolderTreeNav
                tree={tree}
                selected={selectedNodeUid}
                onSelect={(node) => {
                  if (node.items.length === 0) {
                    setSelectedNodeUid(node.uid);
                  }
                }}
                defaultExpanded={tree.length > 0 ? [tree[0].uid] : []}
                renderExtra={(node) => {
                  if (node.items.length > 0) return null;
                  return null;
                }}
              />
            </div>
          </aside>

          {/* Main: video grid */}
          <main className="flex-1 min-w-0">
            {/* Header row */}
            <div className="flex items-center justify-between mb-3">
              <div className="min-w-0">
                {selectedNode ? (
                  <h2 className="text-sm font-semibold truncate">{selectedNode.title}</h2>
                ) : (
                  <h2 className="text-sm font-semibold truncate">{t("videos.allVideos")}</h2>
                )}
              </div>
              {selectedNode && (
                <ContentCacheButton packId={selectedNode.uid} urls={collectPackUrls(selectedNode)} />
              )}
            </div>

            {/* Folder quick-nav chips (mobile) */}
            {isMobile && (
              <div className="flex gap-2 overflow-x-auto medos-scroll-x pb-2 mb-2 -mx-1 px-1">
                {flattenLeaves(tree).map((node) => (
                  <button
                    key={node.uid}
                    onClick={() => setSelectedNodeUid(node.uid)}
                    className={cn(
                      "shrink-0 h-8 px-3 rounded-full text-xs font-medium border transition-colors whitespace-nowrap",
                      node.uid === selectedNodeUid
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted/60"
                    )}
                  >
                    {node.title}
                  </button>
                ))}
              </div>
            )}

            {/* Video grid */}
            {folderLoading ? (
              <div className="osler-loading">
                <Loader2 className="size-6 animate-spin text-primary" />
                <span className="text-sm">{t("videos.loading")}</span>
              </div>
            ) : folderVideos.length === 0 ? (
              <div className="osler-empty">
                <div className="osler-empty__icon">
                  <VideoIcon className="size-6" />
                </div>
                <div>
                  <p className="osler-empty__title">
                    {t("videos.empty")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {folderVideos.map((video, idx) => {
                  const thumbnail = resolveThumbnail(video);
                  const lang = video.lang ?? "en";
                  return (
                    <motion.button
                      key={video.id}
                      type="button"
                      onClick={() => { haptic("light"); openVideo(video); }}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: Math.min(idx * 0.04, 0.4) }}
                      dir={lang === "ar" ? "rtl" : undefined}
                      lang={lang}
                      className={cn(
                        "text-start group bg-card border border-border rounded-xl overflow-hidden hover:border-primary/40 hover:shadow-md transition-all duration-200 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                        lang === "ar" && "osler-content-ar"
                      )}
                    >
                      {/* Thumbnail */}
                      <div className="relative aspect-video bg-muted overflow-hidden">
                        {thumbnail ? (
                          <img
                            src={thumbnail}
                            alt={video.title}
                            className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                            loading="lazy"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
                            <VideoIcon className="size-8" />
                          </div>
                        )}
                        {/* Play overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-90" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div
                            className="size-12 rounded-full flex items-center justify-center backdrop-blur-sm bg-black/40 border border-white/30 group-hover:scale-110 group-hover:bg-black/60 transition-all"
                            style={{ color: "white" }}
                          >
                            <Play className="size-5 ms-0.5" fill="currentColor" />
                          </div>
                        </div>
                        {/* Duration badge */}
                        {video.duration != null && (
                          <div className="absolute bottom-2 end-2 px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums bg-black/70 text-white">
                            {formatDuration(video.duration)}
                          </div>
                        )}
                        {/* Specialty badge */}
                        {video.specialty && (
                          <div className="absolute top-2 start-2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/60 text-white backdrop-blur-sm">
                            {video.specialty}
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
                                className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/60"
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
              </div>
            )}
          </main>
        </div>
      </div>
    </motion.div>
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
  const plyrRef = React.useRef<Plyr | null>(null);
  const youtubeRef = React.useRef<any>(null);

  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [invidiousMode, setInvidiousMode] = React.useState<boolean>(Boolean(INVIDIOUS_HOST));
  const [showFullDescription, setShowFullDescription] = React.useState(false);

  const isYouTube = video.source.type === "youtube";
  const videoId = isYouTube ? video.source.id : undefined;

  // ── Jump to section helper ──
  const handleJumpToSection = (time: number) => {
    haptic("selection");
    if (isYouTube && !invidiousMode && youtubeRef.current) {
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
  React.useEffect(() => {
    if (!containerRef.current || invidiousMode) return;

    containerRef.current.innerHTML = "";

    let destroyed = false;

    // Helper to init Plyr with a given video element
    function initPlyr(el: HTMLVideoElement) {
      const p = new Plyr(el, {
        controls: [
          "play-large", "play", "progress", "current-time",
          "duration", "mute", "volume", "settings", "pip", "fullscreen",
        ],
        settings: ["speed"],
        speed: { selected: 1, options: PLAYBACK_RATES },
        keyboard: { focused: true, global: false },
        tooltips: { controls: true, seek: true },
        seekTime: 10,
        disableContextMenu: true,
        resetOnEnd: true,
        autoplay: true,
      });
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
          },
          events: {
            onReady: () => {
              if (!destroyed) player.playVideo();
            },
          },
        });

        youtubeRef.current = player;
      }

      boot();

      return () => {
        destroyed = true;
        if (player && typeof player.destroy === "function") {
          try { player.destroy(); } catch { /* noop */ }
        }
        youtubeRef.current = null;
      };
    }

    if (!isYouTube && video.source.url) {
      const videoEl = document.createElement("video");
      videoEl.src = video.source.url;
      videoEl.playsInline = true;
      containerRef.current.appendChild(videoEl);
      const p = initPlyr(videoEl);
      return () => {
        p.destroy();
        plyrRef.current = null;
      };
    }
  }, [isYouTube, videoId, video.source.url, invidiousMode]);

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
      }
    },
    { ignoreInputs: true },
  );

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col safe-screen overflow-hidden">
      {/* Top bar */}
      <header className="h-12 flex items-center px-2 sm:px-4 gap-2 shrink-0 border-b border-border bg-card/80 backdrop-blur-md safe-pt">
        <button
          onClick={() => { haptic('light'); onExit(); }}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors medos-touch-target"
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
          <button
            onClick={() => { haptic('selection'); onPrev(); }}
            className="size-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title="Previous (P)"
          >
            <ChevronLeft className={cn("size-4", rtl && "rtl-flip-x")} />
          </button>
        )}
        {onNext && (
          <button
            onClick={() => { haptic('selection'); onNext(); }}
            className="size-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title="Next (N)"
          >
            <ChevronRight className={cn("size-4", rtl && "rtl-flip-x")} />
          </button>
        )}
        {isYouTube && INVIDIOUS_HOST && (
          <button
            onClick={() => {
              haptic("selection");
              setInvidiousMode((prev) => !prev);
            }}
            className={cn(
              "px-2.5 h-8 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors border",
              invidiousMode
                ? "bg-primary text-primary-foreground border-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60 border-border"
            )}
            title={t("videos.switchPlayer")}
          >
            <ExternalLink className="size-3.5" />
            <span className="hidden md:inline">{invidiousMode ? "Alt Host" : "Standard"}</span>
          </button>
        )}
      </header>

      {/* Body: Main stage (Player + Metadata) + Right Sidebar (Up Next Playlist & Chapters) */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        {/* Main Stage Column */}
        <div className="flex-1 min-w-0 flex flex-col overflow-y-auto lg:overflow-y-auto p-3 sm:p-4 lg:p-6 space-y-4">
          {/* Video Player Container */}
          <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black shadow-lg border border-border/40 shrink-0">
            {invidiousMode && videoId ? (
              <iframe
                src={`https://${INVIDIOUS_HOST}/embed/${videoId}`}
                className="absolute inset-0 w-full h-full"
                style={{ border: "none" }}
                allow="autoplay; encrypted-media; fullscreen"
                allowFullScreen
              />
            ) : (
              <div ref={containerRef} className="absolute inset-0 w-full h-full" />
            )}
          </div>

          {/* YouTube-like Metadata Header */}
          <div className="space-y-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground leading-snug">
              {video.title}
            </h1>

            {/* Instructor / Specialty Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/60">
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
                      className="px-2.5 py-1 rounded-full text-xs font-medium bg-muted/80 hover:bg-primary/15 hover:text-primary border border-border/60 transition-colors shrink-0 flex items-center gap-1.5"
                    >
                      <Clock className="size-3 text-muted-foreground" />
                      <span>{ch.title}</span>
                      <span className="text-[10px] opacity-70 tabular-nums font-mono">
                        ({fmtTime(ch.time)})
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Description box */}
            {video.description && (
              <div className="rounded-xl bg-card border border-border/80 p-4 space-y-2 text-sm leading-relaxed">
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

        {/* Right Sidebar: Up Next Playlist */}
        <aside className="w-full lg:w-96 shrink-0 border-t lg:border-t-0 lg:border-s border-border bg-card/40 flex flex-col h-auto lg:h-full overflow-hidden">
          <div className="p-3 sm:p-4 border-b border-border/60 flex items-center justify-between">
            <h3 className="text-sm font-bold tracking-tight uppercase text-muted-foreground flex items-center gap-2">
              <ListVideo className="size-4 text-primary" />
              {t("videos.upNext")}
            </h3>
            <span className="text-xs font-mono text-muted-foreground px-2 py-0.5 rounded-full bg-muted">
              {playlist.length} {t("videos.videosCount", { n: playlist.length })}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {playlist.map((v) => {
              const isActive = v.id === video.id;
              const thumb = resolveThumbnail(v);
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
                      ? "bg-primary/10 border-primary/40 shadow-sm"
                      : "bg-card/60 hover:bg-card border-border/50 hover:border-border"
                  )}
                >
                  {/* Thumbnail Box */}
                  <div className="relative w-32 aspect-video shrink-0 rounded-lg overflow-hidden bg-muted border border-border/40">
                    {thumb ? (
                      <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" loading="lazy" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                        <VideoIcon className="size-6" />
                      </div>
                    )}
                    {isActive ? (
                      <div className="absolute inset-0 bg-primary/40 backdrop-blur-[1px] flex items-center justify-center">
                        <Play className="size-5 text-white fill-white" />
                      </div>
                    ) : v.duration != null ? (
                      <div className="absolute bottom-1 end-1 px-1 py-0.5 rounded text-[10px] font-mono font-medium bg-black/75 text-white">
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
                      <span className="inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {v.specialty}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ── Tree helpers ──────────────────────────────────────────────────── */

function findFirstLeaf(nodes: ContentTreeNode[]): ContentTreeNode | null {
  for (const n of nodes) {
    if (n.items.length === 0) return n;
    const child = findFirstLeaf(n.items);
    if (child) return child;
  }
  return null;
}

function findNodeByUid(nodes: ContentTreeNode[], uid: string): ContentTreeNode | null {
  for (const n of nodes) {
    if (n.uid === uid) return n;
    const c = findNodeByUid(n.items, uid);
    if (c) return c;
  }
  return null;
}

function collectLeaves(node: ContentTreeNode): ContentTreeNode[] {
  if (node.items.length === 0) return [node];
  return node.items.flatMap(collectLeaves);
}

function flattenLeaves(nodes: ContentTreeNode[]): ContentTreeNode[] {
  const result: ContentTreeNode[] = [];
  function walk(list: ContentTreeNode[]) {
    for (const n of list) {
      if (n.items.length === 0) result.push(n);
      else walk(n.items);
    }
  }
  walk(nodes);
  return result;
}
