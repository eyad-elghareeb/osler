"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Wifi, Smartphone, Loader2, Check, AlertTriangle, Plug, PlugZap, ScanLine, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NetworkTransport, type ConnectionInfo, type ConnectionStatus } from "@/lib/osler/sync";
import { cn } from "@/lib/utils";

export function NetworkSyncPanel() {
  const [transport, setTransport] = React.useState<NetworkTransport | null>(null);
  const [status, setStatus] = React.useState<ConnectionStatus>("idle");
  const [statusMsg, setStatusMsg] = React.useState("");
  const [peerId, setPeerId] = React.useState("");
  const [connections, setConnections] = React.useState<ConnectionInfo[]>([]);
  const [remoteId, setRemoteId] = React.useState("");
  const [initialized, setInitialized] = React.useState(false);

  React.useEffect(() => {
    const t = new NetworkTransport({
      onStatusChanged: (s, m) => {
        setStatus(s);
        setStatusMsg(m);
      },
      onSyncComplete: () => {
        setStatusMsg("Sync complete!");
        setStatus("connected");
      },
      onTransferProgress: () => {},
      onPeerId: (id) => setPeerId(id),
      onConnectionsChanged: (c) => setConnections([...c]),
    });
    setTransport(t);
    setInitialized(true);
    return () => {
      t.stop();
    };
  }, []);

  const handleStart = () => {
    if (transport) transport.start();
  };

  const handleStop = () => {
    if (transport) transport.stop();
  };

  const handleConnect = () => {
    const id = remoteId.trim();
    if (transport && id) transport.connectTo(id);
  };

  const statusColor = {
    idle: "text-muted-foreground",
    connecting: "text-amber-500",
    connected: "text-green-500",
    error: "text-destructive",
  }[status];

  const statusIcon = {
    idle: <Wifi className="size-4" />,
    connecting: <Loader2 className="size-4 animate-spin" />,
    connected: <Check className="size-4" />,
    error: <AlertTriangle className="size-4" />,
  }[status];

  return (
    <div className="space-y-4">
      {/* Status card */}
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <div className={cn("size-10 rounded-lg flex items-center justify-center shrink-0", statusColor, "bg-card border border-border")}>
            {statusIcon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold mb-1">Peer-to-Peer Sync</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Connect directly to another device and sync your progress.
            </p>

            <div className={cn("text-xs font-medium mb-2 flex items-center gap-2", statusColor)}>
              {statusIcon}
              <span>{statusMsg || "Not connected"}</span>
            </div>

            {peerId && (
              <div className="text-[10px] text-muted-foreground mb-3 font-mono">
                Your Peer ID: {peerId}
              </div>
            )}

            <div className="flex gap-2">
              {status === "idle" || status === "error" ? (
                <Button size="sm" variant="default" className="h-8 text-xs" onClick={handleStart}>
                  <Plug className="size-3 me-1.5" /> Start PeerJS
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleStop}>
                  <PlugZap className="size-3 me-1.5" /> Stop
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Connect to remote */}
      {peerId && (
        <Card className="p-4">
          <h4 className="text-xs font-semibold text-muted-foreground mb-3">Connect to Device</h4>
          <div className="flex gap-2">
            <Input
              placeholder="Enter remote Peer ID..."
              value={remoteId}
              onChange={(e) => setRemoteId(e.target.value)}
              className="h-8 text-xs"
              onKeyDown={(e) => { if (e.key === "Enter") handleConnect(); }}
            />
            <Button
              size="sm"
              variant="default"
              className="h-8 text-xs shrink-0"
              onClick={handleConnect}
              disabled={!remoteId.trim() || status === "connecting"}
            >
              <ArrowRight className="size-3 me-1.5" /> Connect
            </Button>
          </div>
        </Card>
      )}

      {/* Connections list */}
      {connections.length > 0 && (
        <Card className="p-4">
          <h4 className="text-xs font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <Smartphone className="size-3.5" />
            Connections ({connections.length})
          </h4>
          <div className="space-y-2">
            {connections.map((conn) => (
              <div
                key={conn.peerId}
                className="flex items-center justify-between p-3 rounded-lg border border-border/60 bg-card"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    "size-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold",
                    conn.status === "connected" ? "bg-green-500/10 text-green-500" : "bg-amber-500/10 text-amber-500",
                  )}>
                    {conn.label.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{conn.label}</div>
                    <div className="text-[10px] text-muted-foreground">{conn.status}</div>
                  </div>
                </div>
                <div className={cn(
                  "size-2 rounded-full shrink-0",
                  conn.status === "connected" ? "bg-green-500" : conn.status === "connecting" ? "bg-amber-500 animate-pulse" : "bg-muted-foreground/40",
                )} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
