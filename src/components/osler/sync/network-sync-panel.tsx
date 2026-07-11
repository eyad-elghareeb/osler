"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Wifi,
  Smartphone,
  Loader2,
  Check,
  AlertTriangle,
  Radio,
  RefreshCw,
  ArrowRight,
  QrCode,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NetworkTransport,
  type ConnectionInfo,
  type ConnectionStatus,
  type DiscoveredDevice,
} from "@/lib/osler/sync";
import { cn } from "@/lib/utils";
import { useI18n } from "@/components/osler/i18n-provider";
import { PeerLinkQrPanel } from "./qr-sync-panel";

export function NetworkSyncPanel() {
  const { t } = useI18n();
  const [transport, setTransport] = React.useState<NetworkTransport | null>(null);
  const [devices, setDevices] = React.useState<DiscoveredDevice[]>([]);
  const [status, setStatus] = React.useState<ConnectionStatus>("idle");
  const [statusMsg, setStatusMsg] = React.useState("");
  const [roomId, setRoomId] = React.useState("");
  const [connections, setConnections] = React.useState<ConnectionInfo[]>([]);
  const [peerId, setPeerId] = React.useState("");
  const [manualId, setManualId] = React.useState("");

  React.useEffect(() => {
    const tr = new NetworkTransport({
      onStatusChanged: (s, m) => {
        setStatus(s);
        setStatusMsg(m);
      },
      onSyncComplete: () => {
        setStatusMsg(t("sync.network.complete"));
        setStatus("connected");
      },
      onTransferProgress: () => {},
      onPeerId: (id) => setPeerId(id),
      onConnectionsChanged: (c) => setConnections([...c]),
      onDevicesChanged: (d) => setDevices([...d]),
      onRoomId: (id) => setRoomId(id),
    });
    setTransport(tr);
    return () => {
      tr.stop();
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

  const handleManualConnect = () => {
    const id = manualId.trim();
    if (transport && id) {
      transport.connectTo(id);
      setManualId("");
    }
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

  const transportReady = !!(transport && peerId && status !== "idle" && status !== "error");

  return (
    <div className="space-y-4">
      {/* Status card */}
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "size-10 rounded-lg flex items-center justify-center shrink-0",
              statusColor,
              "bg-card border border-border",
            )}
          >
            {statusIcon}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold mb-1">{t("sync.network.title")}</h3>
            <p className="text-xs text-muted-foreground mb-3">{t("sync.network.desc")}</p>

            <div className={cn("text-xs font-medium mb-2 flex items-center gap-2", statusColor)}>
              {statusIcon}
              <span>
                {statusMsg ||
                  (status === "idle" ? t("sync.network.idle") : t("sync.network.connected"))}
              </span>
            </div>

            {(roomId || peerId) && (
              <div className="text-[10px] text-muted-foreground mb-3 font-mono break-all">
                {peerId && <>{t("sync.network.peerId", { id: peerId })}</>}
                {roomId && <> · {t("sync.network.room", { id: roomId })}</>}
                {transport?.deviceName && (
                  <> · {t("sync.network.device", { name: transport.deviceName })}</>
                )}
              </div>
            )}

            <div className="flex gap-2">
              {status === "idle" || status === "error" ? (
                <Button size="sm" variant="default" className="h-8 text-xs" onClick={handleStart}>
                  <Radio className="size-3 me-1.5" /> {t("sync.network.startDiscovery")}
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleStop}>
                  <RefreshCw className="size-3 me-1.5" /> {t("sync.network.stop")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Peer-link QR — always visible so the user can scan-and-connect even
          before MQTT discovery finds anyone (e.g. across VLANs / VPNs). */}
      <PeerLinkQrPanel
        transport={transport}
        peerId={peerId}
        deviceName={transport?.deviceName ?? ""}
      />

      {/* Device list — discovered via MQTT */}
      {devices.length > 0 && (
        <Card className="p-4">
          <h4 className="text-xs font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <Smartphone className="size-3.5" />
            {t("sync.network.devices", { n: devices.length })}
          </h4>
          <div className="space-y-2">
            {devices.map((device) => {
              const connected = connections.some(
                (c) => c.peerId === device.peerJsId && c.status === "connected",
              );
              return (
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
                        {Math.max(0, Math.round((Date.now() - device.lastSeen) / 1000))}s ago
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={connected ? "secondary" : "outline"}
                    className="h-7 text-xs shrink-0"
                    onClick={() => handleConnect(device.id)}
                    disabled={status === "connecting" || connected}
                  >
                    {connected ? (
                      <>
                        <Check className="size-3 me-1.5" /> {t("sync.network.connected")}
                      </>
                    ) : (
                      t("sync.network.sync")
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Active connections */}
      {connections.length > 0 && (
        <Card className="p-4">
          <h4 className="text-xs font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <Check className="size-3.5 text-green-500" />
            {t("sync.network.activeConnections", { n: connections.length })}
          </h4>
          <div className="space-y-2">
            {connections.map((c) => (
              <div
                key={c.peerId}
                className="flex items-center justify-between p-2.5 rounded-lg border border-border/60 bg-card"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={cn(
                      "size-2 rounded-full shrink-0",
                      c.status === "connected"
                        ? "bg-green-500"
                        : c.status === "connecting"
                          ? "bg-amber-500"
                          : "bg-muted-foreground",
                    )}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{c.label}</div>
                    <div className="text-[10px] text-muted-foreground">{c.status}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Empty state — manual connect */}
      {transportReady && devices.length === 0 && connections.length === 0 && (
        <Card className="p-5 border-dashed">
          <div className="text-center text-sm text-muted-foreground">
            <QrCode className="size-7 mx-auto mb-2 opacity-40" />
            <p>{t("sync.network.noDevices")}</p>
            <p className="text-xs mt-1">{t("sync.network.scanning")}</p>
          </div>

          {/* Manual connect */}
          <div className="flex gap-2 mt-4 max-w-sm mx-auto">
            <Input
              placeholder={t("sync.network.manualPlaceholder")}
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              className="h-9 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleManualConnect();
              }}
            />
            <Button
              size="sm"
              variant="default"
              className="h-9 text-xs shrink-0"
              onClick={handleManualConnect}
              disabled={!manualId.trim() || status === "connecting"}
            >
              <ArrowRight className="size-3 me-1.5" /> {t("sync.network.connect")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
