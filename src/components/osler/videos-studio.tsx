"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PlayCircle,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings2,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Clock,
  Search,
  Tag,
  Loader2,
  Folder,
  Video as VideoIcon,
  RotateCcw,
  SkipForward,
  ListVideo,
  X,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import {
  loadVideoTree,
  loadNodeVideos,
  listAllVideos,
  searchVideos as searchVideosAsync,
  resolveThumbnail,
  formatDuration,
} from "@/lib/osler/videos";
import type { VideoResource, ContentTreeNode } from "@/lib/osler/types";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { setImmersiveMode } from "./immersive-mode";
import { useI18n } from "./i18n-provider";
import { ContentLangFilter } from "./qbank-studio";
import { FolderTreeNav } from "./folder-tree-nav";
import { ContentCacheButton } from "./content-cache-button";

/* ── Constants ─────────────────────────────────────────────────────── */

const VIDEO_COLOR = "oklch(0.68 0.18 195)";

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * Minimal YouTube IFrame API surface — only what we use.
 * Declared as `any` to keep the loader footprint tiny.
 */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getVolume(): number;
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getPlayerState(): number;
  loadVideoById(id: string): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement | string,
    opts: {
      videoId?: string;
      playerVars?: Record<string, unknown>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number; target: YTPlayer }) => void;
        onError?: (e: { data: number; target: YTPlayer }) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: {
    UNSTARTED: -1;
    ENDED: 0;
    PLAYING: 1;
    PAUSED: 2;
    BUFFERING: 3;
    CUED: 5;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/* ── API loader ────────────────────────────────────────────────────── */

let apiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeAPI(): Promise<YTNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("No window"));
  }
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    // Inject the script tag if it's not already there.
    const existing = document.getElementById("yt-iframe-api");
    if (!existing) {
      const tag = document.createElement("script");
      tag.id = "yt-iframe-api";
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
  return apiPromise;
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

function findChapterForTime(chapters: VideoResource["chapters"], t: number): number {
  if (!chapters || chapters.length === 0) return -1;
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (t >= chapters[i].time) idx = i;
    else break;
  }
  return idx;
}

/**
 * Strip every trace of the upstream video provider from the underlying iframe
 * element. We can only touch attributes on the iframe itself (cross-origin
 * prevents reaching inside), but this is enough to keep the iframe out of the
 * accessibility tree and the keyboard focus order — so screen readers and Tab
 * navigation never reveal the upstream host.
 *
 * The visible YouTube logo watermark & end-screen "Watch on YouTube" link are
 * handled separately by clipping the iframe's bottom strip via an oversized
 * wrapper (see `loadYouTubeAPI` callback).
 */
function stripProviderBranding(container: HTMLElement | null) {
  if (!container) return;
  try {
    const iframes = container.querySelectorAll("iframe");
    iframes.forEach((iframe) => {
      iframe.setAttribute("tabindex", "-1");
      iframe.setAttribute("aria-hidden", "true");
      iframe.setAttribute("title", "");
      iframe.removeAttribute("aria-label");
      // Make sure the iframe itself can't be the source of a focus ring.
      iframe.style.outline = "none";
      // Allow our overlay to capture all clicks; the iframe still renders the
      // video frames underneath.
      iframe.style.pointerEvents = "none";
    });
  } catch {
    // ignore — best-effort cleanup
  }
}

/* ── Component ─────────────────────────────────────────────────────── */

interface VideosStudioProps {
  /** Pre-selected video (used for deep links). */
  initialVideoId?: string;
  /** Optional callback to open a library article. */
  onOpenArticle?: (id: string) => void;
}

export function VideosStudio({ initialVideoId, onOpenArticle }: VideosStudioProps) {
  const isMobile = useIsMobile();
  const { t, contentFilter, rtl } = useI18n();

  const [tree, setTree] = React.useState<ContentTreeNode[]>([]);
  const [selectedNodeUid, setSelectedNodeUid] = React.useState<string | null>(null);
  const [folderVideos, setFolderVideos] = React.useState<VideoResource[]>([]);
  const [folderLoading, setFolderLoading] = React.useState(false);
  const [allVideos, setAllVideos] = React.useState<Array<VideoResource & { nodeUid: string; nodePath: string }>>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<Array<VideoResource & { nodeUid: string; nodePath: string }>>([]);
  const [searching, setSearching] = React.useState(false);

  // The active video being played (or null = hub view).
  const [activeVideo, setActiveVideo] = React.useState<(VideoResource & { nodeUid: string; nodePath: string }) | null>(null);
  // Playlist: list of other videos in the same folder (for "up next").
  const [playlist, setPlaylist] = React.useState<VideoResource[]>([]);

  // Sidebar open/close for mobile.
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

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

  // Debounce search.
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 200);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Run search when the debounced query changes.
  React.useEffect(() => {
    if (!debouncedSearch.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchVideosAsync(debouncedSearch)
      .then((r) => setSearchResults(r))
      .finally(() => setSearching(false));
  }, [debouncedSearch]);

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
    // Collect all leaf nodes under this node (could be itself or its descendants).
    const leaves = collectLeaves(node);
    Promise.all(leaves.map(loadNodeVideos))
      .then((arrays) => setFolderVideos(arrays.flat()))
      .catch((e) => {
        console.error("Failed to load folder videos:", e);
        setFolderVideos([]);
      })
      .finally(() => setFolderLoading(false));
  }, [selectedNodeUid, tree]);

  // Open initial video if provided.
  React.useEffect(() => {
    if (!initialVideoId || allVideos.length === 0) return;
    const found = allVideos.find((v) => v.id === initialVideoId);
    if (found) {
      openVideo(found);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const isSearching = debouncedSearch.trim().length > 0;
  const visibleVideos = isSearching ? searchResults : folderVideos;
  const selectedNode = selectedNodeUid ? findNodeByUid(tree, selectedNodeUid) : null;

  // Per-pack content URLs (for the offline download button).
  function collectPackUrls(node: ContentTreeNode): string[] {
    const ownBase = `/osler-content/videos/${node.path}`;
    const own = (node.files ?? []).map((f) => `${ownBase}${f}`);
    if (node.items.length === 0) return own;
    const childUrls: string[] = [];
    for (const child of node.items) childUrls.push(...collectPackUrls(child));
    return [...own, ...childUrls];
  }

  return (
    <div className="h-full overflow-y-auto medos-scroll medos-tabbar-pad">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-6"
        >
          <div className="flex items-center gap-3 mb-2">
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
              <h1 className="text-xl md:text-2xl font-bold tracking-tight">
                {t("videos.title")}
              </h1>
              <p className="text-xs text-muted-foreground">{t("videos.subtitle")}</p>
            </div>
          </div>
        </motion.div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("videos.search")}
            className="w-full h-10 pl-9 pr-9 rounded-lg border border-border/60 bg-card text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 size-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label={t("common.close")}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <ContentLangFilter />

        {/* Two-pane layout: folder tree (desktop) + video grid */}
        <div className="flex flex-col md:flex-row gap-4 mt-4">
          {/* Desktop sidebar: folder tree */}
          <aside className="hidden md:flex flex-col w-64 shrink-0">
            <div className="bg-card border border-border/60 rounded-xl p-3">
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
                {isSearching ? (
                  <h2 className="text-sm font-semibold truncate">
                    {t("videos.search")} &middot; {searchResults.length} {searchResults.length === 1 ? "video" : "videos"}
                  </h2>
                ) : selectedNode ? (
                  <h2 className="text-sm font-semibold truncate">{selectedNode.title}</h2>
                ) : (
                  <h2 className="text-sm font-semibold truncate">{t("videos.allVideos")}</h2>
                )}
              </div>
              {!isSearching && selectedNode && (
                <ContentCacheButton packId={selectedNode.uid} urls={collectPackUrls(selectedNode)} />
              )}
            </div>

            {/* Folder quick-nav chips (mobile) */}
            {isMobile && !isSearching && (
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
            {folderLoading && !isSearching ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <Loader2 className="size-6 animate-spin text-primary" />
                <span className="text-sm">{t("videos.loading")}</span>
              </div>
            ) : visibleVideos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                <div className="size-14 rounded-full bg-muted/40 flex items-center justify-center">
                  <VideoIcon className="size-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-semibold text-sm mb-1">
                    {isSearching ? t("videos.noResults") : t("videos.empty")}
                  </p>
                  {isSearching && (
                    <p className="text-xs text-muted-foreground">"{debouncedSearch}"</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleVideos.map((video, idx) => {
                  const thumbnail = resolveThumbnail(video);
                  const lang = video.lang ?? "en";
                  return (
                    <motion.button
                      key={video.id}
                      type="button"
                      onClick={() => openVideo(video)}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: Math.min(idx * 0.04, 0.4) }}
                      dir={lang === "ar" ? "rtl" : undefined}
                      lang={lang}
                      className={cn(
                        "text-start group bg-card border border-border/60 rounded-xl overflow-hidden hover:border-primary/40 hover:shadow-md transition-all duration-200 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                        lang === "ar" && "osler-content-ar"
                      )}
                    >
                      {/* Thumbnail */}
                      <div className="relative aspect-video bg-muted overflow-hidden">
                        {thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
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
    </div>
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
  const playerContainerRef = React.useRef<HTMLDivElement>(null);
  const playerHostRef = React.useRef<HTMLDivElement>(null);
  const playerRef = React.useRef<YTPlayer | null>(null);
  const progressTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const [ready, setReady] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [buffering, setBuffering] = React.useState(false);
  const [ended, setEnded] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [volume, setVolume] = React.useState(100);
  const [muted, setMuted] = React.useState(false);
  const [playbackRate, setPlaybackRate] = React.useState(1);
  const [showControls, setShowControls] = React.useState(true);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = React.useState(false);
  const [hoverTime, setHoverTime] = React.useState<number | null>(null);
  const [showPlaylist, setShowPlaylist] = React.useState(false);
  const [hasStarted, setHasStarted] = React.useState(false);
  const controlsTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // The current video id we're tracking — used to detect changes.
  const videoId = video.source.type === "youtube" ? video.source.id : undefined;

  // ── Player lifecycle ──
  React.useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    let createdPlayer: YTPlayer | null = null;

    setReady(false);
    setPlaying(false);
    setEnded(false);
    setHasStarted(false);
    setCurrentTime(0);
    setDuration(0);

    loadYouTubeAPI()
      .then((YT) => {
        if (cancelled || !playerHostRef.current) return;
        // Clear any prior player
        if (playerRef.current) {
          try { playerRef.current.destroy(); } catch {}
          playerRef.current = null;
        }
        // Reset host
        playerHostRef.current.innerHTML = "";

        // Outer wrapper that clips any YouTube chrome (logo watermark, "Watch on
        // YouTube" end-screen link, etc.) by being slightly oversized relative
        // to its parent. The bottom 56px and right 80px are the typical areas
        // where YouTube overlays branding; we shift the iframe up & left and
        // make it slightly larger so those regions fall outside the visible
        // container.
        const wrapper = document.createElement("div");
        wrapper.style.position = "absolute";
        wrapper.style.left = "0";
        wrapper.style.top = "0";
        wrapper.style.width = "100%";
        // Extend ~56px below so the bottom YouTube logo & end-screen link are
        // clipped off-screen.
        wrapper.style.height = "calc(100% + 56px)";
        wrapper.style.pointerEvents = "none";
        playerHostRef.current.appendChild(wrapper);

        const host = document.createElement("div");
        host.style.position = "absolute";
        host.style.inset = "0";
        host.style.width = "100%";
        host.style.height = "100%";
        wrapper.appendChild(host);

        createdPlayer = new YT.Player(host, {
          videoId,
          playerVars: {
            autoplay: 1,
            controls: 0,
            modestbranding: 1,
            rel: 0,
            showinfo: 0,
            iv_load_policy: 3,
            fs: 0,
            disablekb: 1,
            playsinline: 1,
            // Disable as much YouTube chrome as the API allows.
            cc_load_policy: 0,
            origin: typeof window !== "undefined" ? window.location.origin : undefined,
            widget_referrer: typeof window !== "undefined" ? window.location.origin : undefined,
          },
          events: {
            onReady: (e) => {
              if (cancelled) return;
              playerRef.current = e.target;
              // Strip the YouTube identity off the underlying iframe so screen
              // readers and the accessibility tree don't reveal the upstream
              // provider. We can only touch attributes on the iframe element
              // itself (cross-origin prevents reaching inside).
              stripProviderBranding(playerHostRef.current);
              setReady(true);
              setDuration(e.target.getDuration() || 0);
              // Apply default volume
              try {
                setVolume(e.target.getVolume());
                setMuted(e.target.isMuted());
                e.target.setPlaybackRate(playbackRate);
              } catch {}
            },
            onStateChange: (e) => {
              const state = e.data;
              setBuffering(state === 3);
              if (state === 1) {
                setPlaying(true);
                setEnded(false);
                setHasStarted(true);
                setDuration(e.target.getDuration() || 0);
                // Re-strip on every state change — YouTube sometimes re-adds
                // the iframe title attribute after certain events.
                stripProviderBranding(playerHostRef.current);
              } else if (state === 2) {
                setPlaying(false);
              } else if (state === 0) {
                setPlaying(false);
                setEnded(true);
              } else if (state === 5) {
                setPlaying(false);
              }
            },
            onError: () => {
              setBuffering(false);
              setPlaying(false);
            },
          },
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
      if (createdPlayer) {
        try { createdPlayer.destroy(); } catch {}
      }
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // ── Progress polling ──
  React.useEffect(() => {
    if (!ready) return;
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = setInterval(() => {
      if (!playerRef.current) return;
      try {
        setCurrentTime(playerRef.current.getCurrentTime() || 0);
        const d = playerRef.current.getDuration() || 0;
        if (d && Math.abs(d - duration) > 0.5) setDuration(d);
      } catch {}
    }, 250);
    return () => {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
        progressTimerRef.current = null;
      }
    };
  }, [ready, duration]);

  // ── Fullscreen tracking ──
  React.useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // ── Controls auto-hide ──
  function pokeControls() {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (playing) {
      controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 2500);
    }
  }

  React.useEffect(() => {
    pokeControls();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // ── Player actions ──
  function togglePlay() {
    if (!playerRef.current) return;
    try {
      if (playing) {
        playerRef.current.pauseVideo();
      } else {
        playerRef.current.playVideo();
      }
    } catch {}
  }

  function seekTo(t: number) {
    if (!playerRef.current) return;
    try {
      playerRef.current.seekTo(Math.max(0, Math.min(t, duration || 0)), true);
      setCurrentTime(t);
    } catch {}
  }

  function skip(delta: number) {
    seekTo((currentTime || 0) + delta);
  }

  function toggleMute() {
    if (!playerRef.current) return;
    try {
      if (muted) {
        playerRef.current.unMute();
        setMuted(false);
      } else {
        playerRef.current.mute();
        setMuted(true);
      }
    } catch {}
  }

  function changeVolume(v: number) {
    if (!playerRef.current) return;
    try {
      playerRef.current.setVolume(v);
      if (v === 0) setMuted(true);
      else if (muted) {
        playerRef.current.unMute();
        setMuted(false);
      }
      setVolume(v);
    } catch {}
  }

  function changeRate(r: number) {
    if (!playerRef.current) return;
    try {
      playerRef.current.setPlaybackRate(r);
      setPlaybackRate(r);
      setShowSpeedMenu(false);
    } catch {}
  }

  function toggleFullscreen() {
    if (!playerContainerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      playerContainerRef.current.requestFullscreen?.();
    }
  }

  // Keyboard shortcuts (when not typing in an input)
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toLowerCase();
      if (key === " " || key === "k") { e.preventDefault(); togglePlay(); pokeControls(); }
      else if (key === "arrowleft") { e.preventDefault(); skip(-5); pokeControls(); }
      else if (key === "arrowright") { e.preventDefault(); skip(5); pokeControls(); }
      else if (key === "j") { e.preventDefault(); skip(-10); pokeControls(); }
      else if (key === "l") { e.preventDefault(); skip(10); pokeControls(); }
      else if (key === "m") { e.preventDefault(); toggleMute(); pokeControls(); }
      else if (key === "f") { e.preventDefault(); toggleFullscreen(); }
      else if (key === "escape" && !document.fullscreenElement) { e.preventDefault(); onExit(); }
      else if (key === "n" && onNext) { e.preventDefault(); onNext(); }
      else if (key === "p" && onPrev) { e.preventDefault(); onPrev(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, currentTime, duration, muted]);

  // ── Progress bar interaction ──
  const progressBarRef = React.useRef<HTMLDivElement>(null);

  function progressBarValue(clientX: number): number {
    const el = progressBarRef.current;
    if (!el || !duration) return 0;
    const rect = el.getBoundingClientRect();
    const pct = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, rtl ? 1 - pct : pct)) * duration;
  }

  function onProgressClick(e: React.MouseEvent) {
    seekTo(progressBarValue(e.clientX));
  }

  function onProgressMove(e: React.MouseEvent) {
    setHoverTime(progressBarValue(e.clientX));
  }

  function onProgressLeave() {
    setHoverTime(null);
  }

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const hoverPct = hoverTime != null && duration > 0 ? (hoverTime / duration) * 100 : null;

  const currentChapterIdx = findChapterForTime(video.chapters, currentTime);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col safe-screen">
      {/* Top bar */}
      <header
        className={cn(
          "h-12 flex items-center px-2 sm:px-4 gap-2 shrink-0 border-b border-border/60 bg-card safe-pt transition-opacity",
          !showControls && isFullscreen && "opacity-0"
        )}
      >
        <button
          onClick={onExit}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors medos-touch-target"
          title={t("videos.backToVideos")}
        >
          <ArrowLeft className={cn("size-4", rtl && "rtl-flip-x")} />
          <span className="hidden sm:inline">{t("videos.backToVideos")}</span>
        </button>

        <div className="h-5 w-px bg-border/60 hidden sm:block" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {video.specialty && (
              <>
                <span className="font-medium text-foreground truncate">{video.specialty}</span>
                <span className="opacity-50">·</span>
              </>
            )}
            <span className="truncate">{video.title}</span>
          </div>
        </div>

        {onPrev && (
          <button
            onClick={onPrev}
            className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title="Previous (P)"
          >
            <ChevronLeft className={cn("size-4", rtl && "rtl-flip-x")} />
          </button>
        )}
        {onNext && (
          <button
            onClick={onNext}
            className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title="Next (N)"
          >
            <ChevronRight className={cn("size-4", rtl && "rtl-flip-x")} />
          </button>
        )}
        <button
          onClick={() => setShowPlaylist((s) => !s)}
          className={cn(
            "size-7 rounded-md flex items-center justify-center transition-colors",
            showPlaylist ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
          )}
          title={t("videos.playlist")}
        >
          <ListVideo className="size-4" />
        </button>
      </header>

      {/* Body: player + sidebar */}
      <div className="flex-1 min-h-0 flex">
        {/* Player area */}
        <div
          ref={playerContainerRef}
          className="relative flex-1 min-w-0 bg-black flex flex-col"
          onMouseMove={pokeControls}
          onMouseLeave={() => playing && setShowControls(false)}
        >
          {/* Player host (YouTube IFrame mounts here).
              The host is hidden from the accessibility tree and the keyboard
              focus order — the user only ever interacts with the custom
              controls overlay below. The provider's iframe is also stripped
              of its identity attributes (see `stripProviderBranding`). */}
          <div
            ref={playerHostRef}
            aria-hidden="true"
            tabIndex={-1}
            className={cn(
              "absolute inset-0 overflow-hidden transition-opacity duration-300",
              hasStarted ? "opacity-100" : "opacity-0"
            )}
            style={{ pointerEvents: "none" }}
          />

          {/* Poster / loading overlay */}
          {!hasStarted && (
            <div className="absolute inset-0 flex items-center justify-center bg-black">
              {resolveThumbnail(video) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resolveThumbnail(video)}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover opacity-50"
                />
              )}
              <div className="relative z-10 flex flex-col items-center gap-3">
                <div className="size-16 rounded-full flex items-center justify-center bg-white/10 border border-white/30 backdrop-blur-sm">
                  {ready ? (
                    <Play className="size-7 ms-0.5 text-white" fill="currentColor" />
                  ) : (
                    <Loader2 className="size-7 text-white animate-spin" />
                  )}
                </div>
                <p className="text-xs text-white/70">
                  {ready ? t("videos.play") : t("videos.loading")}
                </p>
              </div>
            </div>
          )}

          {/* Buffering spinner overlay (during playback) */}
          {hasStarted && buffering && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <Loader2 className="size-10 text-white animate-spin drop-shadow" />
            </div>
          )}

          {/* Center play/pause button on click (transparent overlay) */}
          {hasStarted && (
            <button
              onClick={togglePlay}
              className="absolute inset-0 flex items-center justify-center bg-transparent"
              aria-label={playing ? t("videos.pause") : t("videos.play")}
            >
              {!playing && !buffering && !ended && (
                <motion.span
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="size-16 rounded-full flex items-center justify-center bg-black/40 border border-white/30 backdrop-blur-sm"
                >
                  <Play className="size-7 ms-0.5 text-white" fill="currentColor" />
                </motion.span>
              )}
              {ended && (
                <motion.span
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="size-16 rounded-full flex items-center justify-center bg-black/40 border border-white/30 backdrop-blur-sm"
                  onClick={(e) => { e.stopPropagation(); seekTo(0); togglePlay(); }}
                >
                  <RotateCcw className="size-7 text-white" />
                </motion.span>
              )}
            </button>
          )}

          {/* Bottom controls bar */}
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 z-10 px-3 pb-3 pt-10 bg-gradient-to-t from-black/80 via-black/40 to-transparent transition-opacity duration-200",
              showControls ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
          >
            {/* Progress bar */}
            <div
              ref={progressBarRef}
              onClick={onProgressClick}
              onMouseMove={onProgressMove}
              onMouseLeave={onProgressLeave}
              className="group relative h-1.5 hover:h-2.5 bg-white/25 rounded-full transition-all cursor-pointer mb-2"
            >
              {/* Hover preview position marker */}
              {hoverPct != null && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white/70 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ insetInlineStart: `${hoverPct}%` }}
                />
              )}
              {/* Buffered/played fill */}
              <div
                className="absolute inset-y-0 start-0 rounded-full bg-primary"
                style={{ width: `${progressPct}%` }}
              />
              {/* Buffered range (approximation: when playing, fill ahead to currentTime + 10%) */}
              {playing && (
                <div
                  className="absolute inset-y-0 start-0 rounded-full bg-white/40"
                  style={{ width: `${Math.min(100, progressPct + 8)}%` }}
                />
              )}
              {/* Playhead */}
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-3 rounded-full bg-primary shadow opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ insetInlineStart: `${progressPct}%` }}
              />
              {/* Hover time tooltip */}
              {hoverTime != null && (
                <div
                  className="absolute -top-7 -translate-x-1/2 px-1.5 py-0.5 rounded text-[10px] tabular-nums bg-black/80 text-white pointer-events-none"
                  style={{ insetInlineStart: `${hoverPct}%` }}
                >
                  {fmtTime(hoverTime)}
                </div>
              )}

              {/* Chapter markers */}
              {video.chapters && video.chapters.length > 0 && duration > 0 && (
                <>
                  {video.chapters.map((ch, i) => {
                    if (i === 0 || ch.time <= 0) return null;
                    const pct = (ch.time / duration) * 100;
                    return (
                      <div
                        key={i}
                        className="absolute top-0 bottom-0 w-0.5 bg-white/60"
                        style={{ insetInlineStart: `${pct}%` }}
                      />
                    );
                  })}
                </>
              )}
            </div>

            {/* Controls row */}
            <div className="flex items-center gap-2 text-white">
              {/* Play/Pause */}
              <button
                onClick={togglePlay}
                className="size-8 rounded-md flex items-center justify-center hover:bg-white/15 transition-colors"
                title={playing ? t("videos.pause") : t("videos.play")}
              >
                {ended ? (
                  <RotateCcw className="size-4" />
                ) : playing ? (
                  <Pause className="size-4" />
                ) : (
                  <Play className="size-4 ms-0.5" fill="currentColor" />
                )}
              </button>

              {/* Skip back/forward */}
              <button
                onClick={() => skip(-10)}
                className="size-8 rounded-md flex items-center justify-center hover:bg-white/15 transition-colors text-xs font-medium"
                title="Back 10s (J)"
              >
                -10s
              </button>
              <button
                onClick={() => skip(10)}
                className="size-8 rounded-md flex items-center justify-center hover:bg-white/15 transition-colors text-xs font-medium"
                title="Forward 10s (L)"
              >
                +10s
              </button>

              {/* Volume */}
              <div className="flex items-center gap-1.5 group/vol">
                <button
                  onClick={toggleMute}
                  className="size-8 rounded-md flex items-center justify-center hover:bg-white/15 transition-colors"
                  title={muted ? t("videos.unmute") : t("videos.mute")}
                >
                  {muted || volume === 0 ? (
                    <VolumeX className="size-4" />
                  ) : (
                    <Volume2 className="size-4" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={muted ? 0 : volume}
                  onChange={(e) => changeVolume(Number(e.target.value))}
                  className="w-0 group-hover/vol:w-16 transition-all duration-200 h-1 cursor-pointer accent-white"
                  aria-label="Volume"
                />
              </div>

              {/* Time */}
              <div className="text-xs tabular-nums ms-1">
                <span className="font-medium">{fmtTime(currentTime)}</span>
                <span className="opacity-60"> / {fmtTime(duration)}</span>
              </div>

              {/* Current chapter */}
              {video.chapters && currentChapterIdx >= 0 && (
                <div className="hidden sm:block text-xs text-white/70 truncate ms-2">
                  · {video.chapters[currentChapterIdx].title}
                </div>
              )}

              <div className="flex-1" />

              {/* Playback rate */}
              <div className="relative">
                <button
                  onClick={() => setShowSpeedMenu((s) => !s)}
                  className="h-8 px-2 rounded-md flex items-center gap-1 hover:bg-white/15 transition-colors text-xs font-medium"
                  title={t("videos.speed")}
                >
                  <Settings2 className="size-3.5" />
                  {playbackRate}×
                </button>
                <AnimatePresence>
                  {showSpeedMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-20"
                        onClick={() => setShowSpeedMenu(false)}
                      />
                      <motion.div
                        initial={{ opacity: 0, y: 4, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.95 }}
                        transition={{ duration: 0.12 }}
                        className="absolute bottom-10 end-0 z-30 bg-card border border-border/60 rounded-lg shadow-xl p-1 min-w-[120px]"
                      >
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-2 py-1">
                          {t("videos.speed")}
                        </div>
                        {PLAYBACK_RATES.map((rate) => (
                          <button
                            key={rate}
                            onClick={() => changeRate(rate)}
                            className={cn(
                              "w-full text-start px-2 py-1.5 rounded-md text-xs hover:bg-muted/60 transition-colors flex items-center justify-between",
                              rate === playbackRate && "text-primary font-medium"
                            )}
                          >
                            <span>{rate}×</span>
                            {rate === 1 && <span className="text-[9px] text-muted-foreground">Normal</span>}
                          </button>
                        ))}
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>

              {/* Next */}
              {onNext && (
                <button
                  onClick={onNext}
                  className="size-8 rounded-md flex items-center justify-center hover:bg-white/15 transition-colors"
                  title={`${t("videos.upNext")} (N)`}
                >
                  <SkipForward className="size-4" />
                </button>
              )}

              {/* Fullscreen */}
              <button
                onClick={toggleFullscreen}
                className="size-8 rounded-md flex items-center justify-center hover:bg-white/15 transition-colors"
                title={isFullscreen ? t("videos.exitFullscreen") : t("videos.fullscreen")}
              >
                {isFullscreen ? (
                  <Minimize className="size-4" />
                ) : (
                  <Maximize className="size-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar: playlist + details */}
        {showPlaylist && (
          <aside className="hidden md:flex flex-col w-80 shrink-0 border-s border-border bg-card overflow-hidden">
            <VideoSidebar
              video={video}
              playlist={playlist}
              onSelect={onSelectFromPlaylist}
              onOpenArticle={onOpenArticle}
              t={t}
            />
          </aside>
        )}
      </div>

      {/* Mobile sidebar drawer */}
      <AnimatePresence>
        {showPlaylist && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            className="md:hidden fixed inset-y-0 end-0 w-80 max-w-[85vw] bg-card border-s border-border z-50 flex flex-col"
          >
            <div className="h-12 shrink-0 flex items-center justify-between px-3 border-b border-border">
              <span className="text-sm font-semibold">{t("videos.playlist")}</span>
              <button
                onClick={() => setShowPlaylist(false)}
                className="size-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60"
              >
                <X className="size-4" />
              </button>
            </div>
            <VideoSidebar
              video={video}
              playlist={playlist}
              onSelect={(v) => {
                onSelectFromPlaylist(v);
                setShowPlaylist(false);
              }}
              onOpenArticle={onOpenArticle}
              t={t}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Sidebar: playlist + video info ────────────────────────────────── */

interface SidebarProps {
  video: VideoResource;
  playlist: VideoResource[];
  onSelect: (v: VideoResource) => void;
  onOpenArticle?: (id: string) => void;
  t: (k: any, p?: any) => string;
}

function VideoSidebar({ video, playlist, onSelect, onOpenArticle, t }: SidebarProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Video info */}
      <div className="p-4 border-b border-border">
        <h2 className="text-base font-bold leading-snug mb-1">{video.title}</h2>
        {video.instructor && (
          <p className="text-xs text-muted-foreground mb-2">{video.instructor}</p>
        )}
        {video.description && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">
            {video.description}
          </p>
        )}
        {video.tags && video.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {video.tags.map((tag) => (
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

        {/* Related articles */}
        {video.relatedArticles && video.relatedArticles.length > 0 && onOpenArticle && (
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 flex items-center gap-1">
              <BookOpen className="size-3" />
              {t("videos.relatedArticles")}
            </div>
            <div className="space-y-1">
              {video.relatedArticles.map((id) => (
                <button
                  key={id}
                  onClick={() => onOpenArticle(id)}
                  className="w-full text-start px-2 py-1.5 rounded-md text-xs hover:bg-muted/60 transition-colors flex items-center gap-2"
                >
                  <BookOpen className="size-3 text-muted-foreground shrink-0" />
                  <span className="truncate">{id.replace(/\.md$/, "").replace(/-/g, " ")}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chapters */}
        {video.chapters && video.chapters.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5 flex items-center gap-1">
              <ListVideo className="size-3" />
              {t("videos.chapters")}
            </div>
            <div className="space-y-0.5">
              {video.chapters.map((ch, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-2 py-1 rounded-md text-xs hover:bg-muted/60 transition-colors"
                >
                  <span className="text-[10px] text-muted-foreground tabular-nums w-10 shrink-0">
                    {fmtTime(ch.time)}
                  </span>
                  <span className="truncate">{ch.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Playlist */}
      {playlist.length > 1 && (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <div className="px-4 pt-3 pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
            <ListVideo className="size-3" />
            {t("videos.playlist")}
            <span className="ms-auto text-muted-foreground/60 tabular-nums">{playlist.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto medos-scroll px-2 pb-2">
            {playlist.map((v) => {
              const isActive = v.id === video.id;
              const thumb = resolveThumbnail(v);
              return (
                <button
                  key={v.id}
                  onClick={() => onSelect(v)}
                  className={cn(
                    "w-full text-start flex items-center gap-2 p-2 rounded-md transition-colors group",
                    isActive ? "bg-primary/10" : "hover:bg-muted/60"
                  )}
                >
                  <div className="relative size-16 shrink-0 rounded overflow-hidden bg-muted">
                    {thumb && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                    )}
                    {isActive && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <div className="size-1.5 rounded-full bg-red-500 animate-pulse" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={cn("text-xs font-medium line-clamp-2", isActive && "text-primary")}>
                      {v.title}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                      {v.duration != null && (
                        <>
                          <Clock className="size-2.5" />
                          {formatDuration(v.duration)}
                        </>
                      )}
                      {v.instructor && <span className="truncate">· {v.instructor}</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
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
