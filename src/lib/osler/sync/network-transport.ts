import { Peer } from "peerjs";
import * as SyncProtocol from "./sync-protocol";
import { buildExportPayload, mergePayloadIntoStorage } from "./sync-helpers";
import * as Paho from "paho-mqtt";

/* ── Types ──────────────────────────────────────────────────────────── */

export interface ConnectionInfo {
  peerId: string;
  label: string;
  status: "connecting" | "connected" | "disconnected";
}

export interface DiscoveredDevice {
  id: string;
  name: string;
  peerJsId: string;
  lastSeen: number;
}

export type ConnectionStatus =
  | "idle"
  | "discovering"
  | "connecting"
  | "connected"
  | "error";

export interface SyncPreviewSummary {
  senderName: string;
  packCount: number;
  progressCount: number;
}

export interface IncomingSyncRequest {
  peerId: string;
  label: string;
  preview: SyncPreviewSummary;
  receivedAt: number;
}

export interface TransportCallbacks {
  onStatusChanged: (status: ConnectionStatus, message: string) => void;
  onSyncComplete: (method: "p2p") => void;
  onTransferProgress: (bytesTransferred: number, totalBytes: number) => void;
  onPeerId: (peerId: string) => void;
  onConnectionsChanged: (connections: ConnectionInfo[]) => void;
  onDevicesChanged: (devices: DiscoveredDevice[]) => void;
  onRoomId: (roomId: string) => void;
  /** Fired when a peer pushes sync data over the channel. Nothing is
   *  merged until the user calls {@link NetworkTransport.acceptIncoming}. */
  onIncomingRequest: (request: IncomingSyncRequest) => void;
}

/* ── Device identity ─────────────────────────────────────────────────── */

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

function generateDeviceName(): string {
  if (typeof window === "undefined") return "Device";
  try {
    let name = localStorage.getItem("osler_sync_device_name");
    if (!name) {
      const adjs = ["Red", "Blue", "Gold", "Swift", "Calm", "Bold", "Wise", "Keen"];
      const nouns = ["Owl", "Fox", "Bear", "Wolf", "Hawk", "Lion", "Stag", "Lynx"];
      name = `${adjs[Math.floor(Math.random() * adjs.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
      localStorage.setItem("osler_sync_device_name", name);
    }
    return name;
  } catch {
    return "Device";
  }
}

/* ── Transport ───────────────────────────────────────────────────────── */

export class NetworkTransport {
  readonly localPeerId: string;
  readonly deviceName: string;
  callbacks: TransportCallbacks;

  private peer: Peer | null = null;
  private connections: Map<string, { conn: import("peerjs").DataConnection; info: ConnectionInfo }> = new Map();
  private started = false;
  private discovering = false;

  /** Data received but not yet accepted/rejected by the user. */
  private pending: { peerId: string; label: string; payload: SyncProtocol.SyncPayload } | null = null;

  /* MQTT discovery */
  private mqttClient: unknown = null;
  private roomHash: string | null = null;
  private devices: Record<string, DiscoveredDevice> = {};
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(callbacks: TransportCallbacks) {
    this.callbacks = callbacks;
    this.localPeerId = generateDeviceId();
    this.deviceName = generateDeviceName();
  }

  get isConnected(): boolean {
    return this.started && this.peer !== null && !this.peer.disconnected;
  }

  get discoveredDevices(): DiscoveredDevice[] {
    return Object.values(this.devices);
  }

  get activeConnections(): ConnectionInfo[] {
    return Array.from(this.connections.values()).map((c) => c.info);
  }

  /* ── PeerJS + MQTT discovery ──────────────────────────────────────── */

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.callbacks.onStatusChanged("connecting", "Initializing...");

    try {
      await this.startPeerJS();
      await this.startDiscovery();
    } catch (err) {
      this.started = false;
      this.callbacks.onStatusChanged("error", `Start failed: ${(err as Error).message}`);
    }
  }

  private async startPeerJS(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.callbacks.onStatusChanged("connecting", "Connecting to PeerJS...");

      this.peer = new Peer(this.localPeerId, {
        host: "0.peerjs.com",
        port: 443,
        secure: true,
      });

      const peer = this.peer;

      peer.on("open", () => {
        this.callbacks.onPeerId(this.localPeerId);
        resolve();
      });

      peer.on("connection", (conn) => {
        this.setupIncomingConnection(conn);
      });

      peer.on("error", (err) => {
        if ((err as { type: string }).type === "unavailable-id") {
          const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
          const newId = `${this.localPeerId}-${suffix}`;
          try { localStorage.setItem("osler_sync_device_id", newId); } catch { }
          this.callbacks.onStatusChanged("error", "ID taken, re-registering...");
          this.peer?.destroy();
          this.started = false;
          this.start();
          return;
        }
        reject(err);
      });

      setTimeout(() => {
        if (!peer.open) reject(new Error("PeerJS connection timed out"));
      }, 10000);
    });
  }

  private async startDiscovery(): Promise<void> {
    if (this.discovering) return;
    this.discovering = true;

    this.callbacks.onStatusChanged("discovering", "Discovering devices...");

    try {
      // The MQTT room is opt-in per session: a random code shown to the user.
      // The previous hostname-derived room put every visitor of a deployment
      // into one shared discovery space, where any peer could silently push
      // its full export onto every other device. Two devices sync only when
      // both type the same room code (or connect via QR / manual Peer ID).
      const code = Array.from(crypto.getRandomValues(new Uint8Array(4)))
        .map((b) => "23456789ABCDEFGHJKMNPQRSTUVWXYZ"[b % 29])
        .join("");
      this.roomHash = code;
      this.callbacks.onRoomId(code);

      await this.connectMQTT();
      this.broadcastPresence();

      this.heartbeatTimer = setInterval(() => {
        this.broadcastPresence();
        this.pruneStaleDevices();
      }, 5000);

      this.callbacks.onStatusChanged("connected", "Ready - share the room code or scan the QR");
    } catch (e) {
      console.error("Network discovery failed:", e);
      this.discovering = false;
      this.callbacks.onStatusChanged("connected", `Your ID: ${this.localPeerId} (share with other device)`);
    }
  }

  /** Join the room another device advertised. Both sides must use the same
   *  code for discovery to find each other; data still requires explicit
   *  consent on the receiving side. */
  async joinRoom(code: string): Promise<void> {
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z2-9]{4,10}$/.test(normalized)) {
      this.callbacks.onStatusChanged("error", "Invalid room code");
      return;
    }
    if (!this.started) await this.start();
    if (!this.peer) return;
    // Leave the old room's MQTT subscription behind.
    if (this.mqttClient) {
      try { (this.mqttClient as { disconnect: () => void }).disconnect(); } catch {}
      this.mqttClient = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.devices = {};
    this.callbacks.onDevicesChanged([]);
    this.roomHash = normalized;
    this.callbacks.onRoomId(normalized);
    try {
      await this.connectMQTT();
      this.broadcastPresence();
      this.heartbeatTimer = setInterval(() => {
        this.broadcastPresence();
        this.pruneStaleDevices();
      }, 5000);
      this.callbacks.onStatusChanged("connected", `Joined room ${normalized}`);
    } catch (e) {
      this.callbacks.onStatusChanged("error", `Join failed: ${(e as Error).message}`);
    }
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const { conn } of this.connections.values()) {
      try { conn.close(); } catch { }
    }
    this.connections.clear();
    this.peer?.destroy();
    this.peer = null;
    if (this.mqttClient) {
      try { (this.mqttClient as { disconnect: () => void }).disconnect(); } catch { }
      this.mqttClient = null;
    }
    this.started = false;
    this.discovering = false;
    this.devices = {};
    this.callbacks.onDevicesChanged([]);
    this.callbacks.onConnectionsChanged([]);
    this.callbacks.onStatusChanged("idle", "Disconnected");
  }

  /* ── Connect to peer (by ID or discovered device) ──────────────────── */

  async connectTo(peerJsId: string, label?: string): Promise<void> {
    if (!this.peer) {
      this.callbacks.onStatusChanged("error", "PeerJS not started");
      return;
    }
    await this.initiateConnection(peerJsId, label ?? peerJsId);
  }

  async connectToDevice(deviceId: string): Promise<void> {
    const device = this.devices[deviceId];
    if (!device) {
      this.callbacks.onStatusChanged("error", "Device not found");
      return;
    }
    await this.initiateConnection(device.peerJsId, device.name);
  }

  private async initiateConnection(remotePeerId: string, label: string): Promise<void> {
    if (this.connections.has(remotePeerId)) {
      const entry = this.connections.get(remotePeerId)!;
      if (entry.info.status === "connected") {
        this.callbacks.onStatusChanged("connected", `Connected to ${label} - waiting for their approval`);
      }
      return;
    }

    this.callbacks.onStatusChanged("connecting", `Connecting to ${label}...`);

    const conn = this.peer!.connect(remotePeerId, { reliable: true });
    this.trackConnection(conn, remotePeerId);

    conn.on("open", () => {
      // Opening the channel no longer pushes data. Both sides now land in
      // "connected" and the receiver explicitly accepts before anything is
      // merged; the initiator sends its export only after the receiver asks.
      this.callbacks.onStatusChanged("connected", `Connected to ${label}`);
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

  /* ── Connection tracking ──────────────────────────────────────────── */

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

    conn.on("error", () => {
      info.status = "disconnected";
      this.callbacks.onConnectionsChanged(this.activeConnections);
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

  /* ── Data transfer ─────────────────────────────────────────────────── */

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
    try {
      const payload = SyncProtocol.decode(raw);
      const summary = SyncProtocol.preview(raw);
      // Hold the payload for user review — nothing touches storage until
      // acceptIncoming() is called. A peer that connects and pushes
      // uninvited can no longer mutate this device's data.
      this.pending = { peerId: conn.peer, label: conn.peer, payload };
      this.callbacks.onIncomingRequest({
        peerId: conn.peer,
        label: this.connections.get(conn.peer)?.info.label ?? conn.peer,
        preview: {
          senderName: String(payload.senderName ?? "Unknown device"),
          packCount: summary?.packCount ?? 0,
          progressCount: summary?.progressCount ?? 0,
        },
        receivedAt: Date.now(),
      });
      this.callbacks.onStatusChanged("connected", `Sync offer from ${payload.senderName || "device"} - review to accept`);
    } catch (err) {
      this.callbacks.onStatusChanged("error", `Import failed: ${(err as Error).message}`);
    }
  }

  /** Merge the pending incoming payload into local storage. */
  async acceptIncoming(): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.callbacks.onStatusChanged("connected", "Received data - importing...");
    try {
      await mergePayloadIntoStorage(pending.payload);
      this.callbacks.onSyncComplete("p2p");
    } catch (err) {
      this.callbacks.onStatusChanged("error", `Import failed: ${(err as Error).message}`);
    }
  }

  /** Discard the pending incoming payload without importing. */
  rejectIncoming(): void {
    this.pending = null;
    this.callbacks.onStatusChanged("connected", "Sync offer declined");
  }

  get hasPendingIncoming(): boolean {
    return this.pending !== null;
  }

  /* ── MQTT discovery ────────────────────────────────────────────────── */

  private async connectMQTT(): Promise<void> {
    const client = new Paho.Client("broker.emqx.io", 8084, "/mqtt", `osler-${this.localPeerId}-${Date.now()}`) as unknown as Record<string, unknown>;

    return new Promise<void>((resolve, reject) => {
      client.onConnectionLost = () => { this.discovering = false; };

      client.onMessageArrived = (msg: { destinationName: string; payloadString: string }) => {
        if (msg.destinationName === `osler/sync/v2/${this.roomHash}/presence`) {
          try {
            const data = JSON.parse(msg.payloadString);
            if (data.id !== this.localPeerId) {
              this.devices[data.id] = {
                id: data.id,
                name: data.name || "Unknown",
                peerJsId: data.peerJsId || data.id,
                lastSeen: Date.now(),
              };
              this.callbacks.onDevicesChanged(this.discoveredDevices);
            }
          } catch { }
        }
      };

      (client as { connect: (opts: Record<string, unknown>) => void }).connect({
        useSSL: true,
        onSuccess: () => {
          this.mqttClient = client;
          (client as { subscribe: (topic: string) => void }).subscribe(`osler/sync/v2/${this.roomHash}/presence`);
          resolve();
        },
        onFailure: (err: unknown) => reject(new Error(`MQTT: ${(err as { errorMessage: string }).errorMessage}`)),
        timeout: 5,
        keepAliveInterval: 20,
      });
    });
  }

  private broadcastPresence(): void {
    if (!this.mqttClient || !this.roomHash) return;
    const payload = JSON.stringify({
      id: this.localPeerId,
      name: this.deviceName,
      peerJsId: this.localPeerId,
      timestamp: Date.now(),
    });
    try {
      (this.mqttClient as { send: (topic: string, payload: string) => void }).send(
        `osler/sync/v2/${this.roomHash}/presence`,
        payload,
      );
    } catch { }
  }

  private pruneStaleDevices(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, device] of Object.entries(this.devices)) {
      if (now - device.lastSeen > 15000) {
        delete this.devices[id];
        changed = true;
      }
    }
    if (changed) {
      this.callbacks.onDevicesChanged(this.discoveredDevices);
    }
  }
}
