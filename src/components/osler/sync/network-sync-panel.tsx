"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Wifi, Smartphone, Loader2, Check, AlertTriangle, Radio, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NetworkTransport, type ConnectionInfo, type ConnectionStatus, type DiscoveredDevice } from "@/lib/osler/sync";
import { cn } from "@/lib/utils";

export function NetworkSyncPanel() {
  const [transport, setTransport] = React.useState<NetworkTransport | null>(null);
  const [devices, setDevices] = React.useState<DiscoveredDevice[]>([]);
  const [status, setStatus] = React.useState<ConnectionStatus>("idle");
  const [statusMsg, setStatusMsg] = React.useState("");
  const [roomId, setRoomId] = React.useState("");
  const [connections, setConnections] = React.useState<ConnectionInfo[]>([]);
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
      onPeerId: () => {},
      onConnectionsChanged: (c) => setConnections([...c]),
      onDevicesChanged: (d) => setDevices([...d]),
      onRoomId: (id) => setRoomId(id),
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

  const handleConnect = (deviceId: string) => {
    if (transport) transport.connectToDevice(deviceId);
  };

  const statusColor = {
    idle: "text-muted-foreground",
    discovering: "text-primary",
    connecting: "text-amber-500",
    connected: "text-green-500",
    error: "text-destructive",
  }[status];

  const statusIcon = {
    idle: <Wifi className="size-4" />,
    discovering: <Loader2 className="size-4 animate-spin" />,
    connecting: <Radio className="size-4 animate-pulse" />,
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
            <h3 className="text-sm font-semibold mb-1">Network Sync</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Discover devices on the same network and sync your progress peer-to-peer.
            </p>

            <div className={cn("text-xs font-medium mb-2 flex items-center gap-2", statusColor)}>
              {statusIcon}
              <span>{statusMsg || (status === "idle" ? "Not connected" : "Connected")}</span>
            </div>

            {roomId && (
              <div className="text-[10px] text-muted-foreground mb-3 font-mono">
                Room: {roomId} · Device: {transport?.deviceName ?? "..."}
              </div>
            )}

            <div className="flex gap-2">
              {status === "idle" || status === "error" ? (
                <Button size="sm" variant="default" className="h-8 text-xs" onClick={handleStart}>
                  <Radio className="size-3 me-1.5" /> Start Discovery
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleStop}>
                  <RefreshCw className="size-3 me-1.5" /> Stop
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Device list */}
      {devices.length > 0 && (
        <Card className="p-4">
          <h4 className="text-xs font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <Smartphone className="size-3.5" />
            Devices on Network ({devices.length})
          </h4>
          <div className="space-y-2">
            {devices.map((device) => (
              <div
                key={device.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border/60 bg-card hover:border-primary/40 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-xs font-bold">
                    {device.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{device.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {Math.round((Date.now() - device.lastSeen) / 1000)}s ago
                    </div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs shrink-0"
                  onClick={() => handleConnect(device.id)}
                  disabled={status === "connecting"}
                >
                  Sync
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {devices.length === 0 && (status === "discovering" || status === "connected") && (
        <Card className="p-5 border-dashed">
          <div className="text-center text-sm text-muted-foreground">
            <Radio className="size-8 mx-auto mb-2 opacity-40" />
            <p>Waiting for devices...</p>
            <p className="text-xs mt-1">Make sure the other device has the Sync panel open too.</p>
          </div>
        </Card>
      )}
    </div>
  );
}
