import { Peer } from "peerjs";
import * as SyncProtocol from "./sync-protocol";
import { buildExportPayload, mergePayloadIntoStorage } from "./sync-helpers";

export interface ConnectionInfo {
  peerId: string;
  label: string;
  status: "connecting" | "connected" | "disconnected";
}

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error";

export interface TransportCallbacks {
  onStatusChanged: (status: ConnectionStatus, message: string) => void;
  onSyncComplete: (method: "p2p") => void;
  onTransferProgress: (bytesTransferred: number, totalBytes: number) => void;
  onPeerId: (peerId: string) => void;
  onConnectionsChanged: (connections: ConnectionInfo[]) => void;
}

function generateDeviceId(): string {
  if (typeof window === "undefined") return "unknown";
  try {
    let id = localStorage.getItem("osler_sync_device_id");
    if (!id) {
      id = Math.random().toString(36).substring(2, 8).toUpperCase();
      localStorage.setItem("osler_sync_device_id", id);
    }
    return id;
  } catch {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }
}

export class NetworkTransport {
  readonly localPeerId: string;
  callbacks: TransportCallbacks;

  private peer: Peer | null = null;
  private connections: Map<string, { conn: import("peerjs").DataConnection; info: ConnectionInfo }> = new Map();
  private started = false;

  constructor(callbacks: TransportCallbacks) {
    this.callbacks = callbacks;
    this.localPeerId = generateDeviceId();
  }

  get isConnected(): boolean {
    return this.started && this.peer !== null && !this.peer.disconnected;
  }

  get activeConnections(): ConnectionInfo[] {
    return Array.from(this.connections.values()).map((c) => c.info);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.callbacks.onStatusChanged("connecting", "Initializing PeerJS...");

    try {
      this.peer = new Peer(this.localPeerId, {
        host: "0.peerjs.com",
        port: 443,
        secure: true,
      });

      await new Promise<void>((resolve, reject) => {
        const peer = this.peer!;

        peer.on("open", () => {
          this.callbacks.onPeerId(this.localPeerId);
          this.callbacks.onStatusChanged("connected", "Ready to sync");
          resolve();
        });

        peer.on("connection", (conn) => {
          this.setupIncomingConnection(conn);
        });

        peer.on("error", (err) => {
          if ((err as { type: string }).type === "unavailable-id") {
            // ID collision — re-register with a random suffix
            const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
            const newId = `${this.localPeerId}-${suffix}`;
            try { localStorage.setItem("osler_sync_device_id", newId); } catch { }
            this.callbacks.onStatusChanged("error", "Device ID taken, re-registering...");
            this.peer?.destroy();
            this.started = false;
            this.start();
            return;
          }
          reject(err);
        });

        // Timeout if PeerJS doesn't connect within 10s
        setTimeout(() => {
          if (!peer.open) reject(new Error("PeerJS connection timed out"));
        }, 10000);
      });
    } catch (err) {
      this.started = false;
      this.callbacks.onStatusChanged("error", `PeerJS failed: ${(err as Error).message}`);
    }
  }

  stop(): void {
    for (const { conn } of this.connections.values()) {
      try { conn.close(); } catch { }
    }
    this.connections.clear();
    this.peer?.destroy();
    this.peer = null;
    this.started = false;
    this.callbacks.onStatusChanged("idle", "Disconnected");
    this.callbacks.onConnectionsChanged([]);
  }

  async connectTo(remotePeerId: string): Promise<void> {
    if (!this.peer) {
      this.callbacks.onStatusChanged("error", "Start PeerJS first");
      return;
    }

    if (this.connections.has(remotePeerId)) {
      const entry = this.connections.get(remotePeerId)!;
      if (entry.info.status === "connected") {
        this.callbacks.onStatusChanged("connected", "Already connected — re-sending data...");
        await this.sendExport(entry.conn);
      }
      return;
    }

    this.callbacks.onStatusChanged("connecting", `Connecting to ${remotePeerId}...`);

    const conn = this.peer.connect(remotePeerId, { reliable: true });
    this.trackConnection(conn, remotePeerId);

    conn.on("open", () => {
      this.callbacks.onStatusChanged("connected", "Connected! Sending data...");
      this.sendExport(conn);
    });

    setTimeout(() => {
      const entry = this.connections.get(remotePeerId);
      if (entry && entry.info.status === "connecting") {
        entry.info.status = "disconnected";
        this.callbacks.onConnectionsChanged(this.activeConnections);
        this.callbacks.onStatusChanged("error", "Connection timed out");
      }
    }, 15000);
  }

  private trackConnection(conn: import("peerjs").DataConnection, peerId: string): void {
    const info: ConnectionInfo = { peerId, label: peerId, status: "connecting" };
    this.connections.set(peerId, { conn, info });
    this.callbacks.onConnectionsChanged(this.activeConnections);

    conn.on("open", () => {
      info.status = "connected";
      this.callbacks.onConnectionsChanged(this.activeConnections);
    });

    conn.on("close", () => {
      info.status = "disconnected";
      this.callbacks.onConnectionsChanged(this.activeConnections);
      this.connections.delete(peerId);
    });

    conn.on("error", (err) => {
      info.status = "disconnected";
      this.callbacks.onConnectionsChanged(this.activeConnections);
      this.callbacks.onStatusChanged("error", `Connection error: ${(err as Error).message}`);
      this.connections.delete(peerId);
    });
  }

  private setupIncomingConnection(conn: import("peerjs").DataConnection): void {
    const peerId = conn.peer;
    this.trackConnection(conn, peerId);

    conn.on("data", (raw: unknown) => {
      if (typeof raw !== "string" || !raw) return;
      this.handleIncomingData(conn, raw);
    });
  }

  private async sendExport(conn: import("peerjs").DataConnection): Promise<void> {
    try {
      const payload = await buildExportPayload();
      const wire = SyncProtocol.encode(payload);
      conn.send(wire);
      this.callbacks.onTransferProgress(wire.length, wire.length);
      this.callbacks.onStatusChanged("connected", "Data sent!");
    } catch (err) {
      this.callbacks.onStatusChanged("error", `Send failed: ${(err as Error).message}`);
    }
  }

  private async handleIncomingData(conn: import("peerjs").DataConnection, raw: string): Promise<void> {
    this.callbacks.onStatusChanged("connected", "Received data — importing...");
    try {
      const payload = SyncProtocol.decode(raw);
      await mergePayloadIntoStorage(payload);
      this.callbacks.onSyncComplete("p2p");
    } catch (err) {
      this.callbacks.onStatusChanged("error", `Import failed: ${(err as Error).message}`);
    }
  }

  disconnect(peerId: string): void {
    const entry = this.connections.get(peerId);
    if (entry) {
      try { entry.conn.close(); } catch { }
      this.connections.delete(peerId);
      this.callbacks.onConnectionsChanged(this.activeConnections);
    }
  }
}
