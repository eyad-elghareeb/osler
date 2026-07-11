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
  Search,
  Tag,
  Loader2,
  Folder,
  Video as VideoIcon,
  ListVideo,
  X,
  BookOpen,
  ExternalLink,
} from "lucide-react";
import Plyr from "plyr";
import "plyr/dist/plyr.css";
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
import { useShortcutListener } from "@/hooks/use-shortcuts";
import { useI18n } from "./i18n-provider";
import { ContentLangFilter } from "./qbank-studio";
import { FolderTreeNav } from "./folder-tree-nav";
import { ContentCacheButton } from "./content-cache-button";

/* ── Constants ─────────────────────────────────────────────────────── */

const VIDEO_COLOR = "oklch(0.68 0.18 195)";

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** Public Invidious instances shown in the alternative-host dropdown. */
const INVIDIOUS_HOSTS: { host: string; label: string }[] = [
  { host: "inv.nadeko.net", label: "inv.nadeko.net" },
  { host: "yewtu.be", label: "yewtu.be" },
  { host: "invidious.snopyta.org", label: "invidious.snopyta.org" },
  { host: "inv.vern.cc", label: "inv.vern.cc" },
  { host: "iv.ggtyler.dev", label: "iv.ggtyler.dev" },
  { host: "yt.artemislena.eu", label: "yt.artemislena.eu" },
  { host: "invidious.private.coffee", label: "invidious.private.coffee" },
  { host: "invidious.no-logs.com", label: "invidious.no-logs.com" },
];

/* ── Helpers ───────────────────────────────────────────────────────── */

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
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
  const containerRef = React.useRef<HTMLDivElement>(null);
  const plyrRef = React.useRef<Plyr | null>(null);
  const youtubeRef = React.useRef<any>(null);

  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [showPlaylist, setShowPlaylist] = React.useState(false);
  const [invidiousHost, setInvidiousHost] = React.useState<string | null>(null);
  const [invidiousMenuOpen, setInvidiousMenuOpen] = React.useState(false);
  const invidiousMenuRef = React.useRef<HTMLDivElement>(null);

  const isYouTube = video.source.type === "youtube";
  const videoId = isYouTube ? video.source.id : undefined;

  // ── Initialise player: YouTube IFrame API or Plyr ──
  React.useEffect(() => {
    if (!containerRef.current) return;

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
  }, [isYouTube, videoId, video.source.url]);

  // ── Close invidious menu on outside click ──
  React.useEffect(() => {
    if (!invidiousMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (invidiousMenuRef.current && !invidiousMenuRef.current.contains(e.target as Node)) {
        setInvidiousMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [invidiousMenuOpen]);

  // ── Fullscreen tracking ──
  React.useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // ── Keyboard shortcuts (customizable via settings) ──
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

  function selectInvidiousHost(host: string) {
    setInvidiousHost(host);
    setInvidiousMenuOpen(false);
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col safe-screen">
      {/* Top bar */}
      <header className="h-12 flex items-center px-2 sm:px-4 gap-2 shrink-0 border-b border-border/60 bg-card safe-pt">
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
        {isYouTube && !invidiousHost && (
          <div ref={invidiousMenuRef} className="relative">
            <button
              onClick={() => setInvidiousMenuOpen((s) => !s)}
              className={cn(
                "size-7 rounded-md flex items-center justify-center transition-colors",
                invidiousMenuOpen ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
              title="Play via alternative host"
            >
              <ExternalLink className="size-3.5" />
            </button>
            {invidiousMenuOpen && (
              <div
                className="absolute top-full end-0 mt-1 w-56 bg-card border border-border/60 rounded-xl shadow-xl py-1 z-50"
                style={{ maxHeight: "320px", overflowY: "auto" }}
              >
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Invidious instance
                </div>
                {INVIDIOUS_HOSTS.map(({ host, label }) => (
                  <button
                    key={host}
                    onClick={() => selectInvidiousHost(host)}
                    className="w-full text-start px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
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
        <div className="relative flex-1 min-w-0 bg-black">
          {invidiousHost && videoId ? (
            <iframe
              src={`https://${invidiousHost}/embed/${videoId}`}
              className="absolute inset-0 w-full h-full"
              style={{ border: "none" }}
              allow="autoplay; encrypted-media; fullscreen"
              allowFullScreen
            />
          ) : (
            <div ref={containerRef} className="absolute inset-0" />
          )}
        </div>

        {/* Sidebar: playlist + details */}
        {showPlaylist && !isFullscreen && (
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
        {showPlaylist && !isFullscreen && (
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
