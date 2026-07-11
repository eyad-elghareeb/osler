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

export interface TransportCallbacks {
  onStatusChanged: (status: ConnectionStatus, message: string) => void;
  onSyncComplete: (method: "p2p") => void;
  onTransferProgress: (bytesTransferred: number, totalBytes: number) => void;
  onPeerId: (peerId: string) => void;
  onConnectionsChanged: (connections: ConnectionInfo[]) => void;
  onDevicesChanged: (devices: DiscoveredDevice[]) => void;
  onRoomId: (roomId: string) => void;
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
      const ip = await this.getPublicIP();
      const hash = this.hashString(`osler-sync-v2-${ip}`);
      this.roomHash = hash.substring(0, 8).toUpperCase();
      this.callbacks.onRoomId(this.roomHash);

      await this.connectMQTT();
      this.broadcastPresence();

      this.heartbeatTimer = setInterval(() => {
        this.broadcastPresence();
        this.pruneStaleDevices();
      }, 5000);

      this.callbacks.onStatusChanged("connected", "Ready — devices will appear automatically");
    } catch (e) {
      console.error("Network discovery failed:", e);
      this.discovering = false;
      this.callbacks.onStatusChanged("connected", `Your ID: ${this.localPeerId} (share with other device)`);
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
        this.callbacks.onStatusChanged("connected", "Re-sending data...");
        await this.sendExport(entry.conn);
      }
      return;
    }

    this.callbacks.onStatusChanged("connecting", `Connecting to ${label}...`);

    const conn = this.peer!.connect(remotePeerId, { reliable: true });
    this.trackConnection(conn, remotePeerId);

    conn.on("open", () => {
      this.callbacks.onStatusChanged("connected", `Syncing with ${label}...`);
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

  private async handleIncomingData(_conn: import("peerjs").DataConnection, raw: string): Promise<void> {
    this.callbacks.onStatusChanged("connected", "Received data — importing...");
    try {
      const payload = SyncProtocol.decode(raw);
      await mergePayloadIntoStorage(payload);
      this.callbacks.onSyncComplete("p2p");
    } catch (err) {
      this.callbacks.onStatusChanged("error", `Import failed: ${(err as Error).message}`);
    }
  }

  /* ── MQTT discovery ────────────────────────────────────────────────── */

  private async getPublicIP(): Promise<string> {
    return new Promise((resolve) => {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      pc.createDataChannel("x");
      pc.createOffer().then((offer) => pc.setLocalDescription(offer));
      const ips = new Set<string>();
      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          // All candidates delivered — resolve with first IPv4 or fallback
          const ipv4 = Array.from(ips).find((ip) => ip.includes("."));
          resolve(ipv4 ?? ips.values().next().value ?? "0.0.0.0");
          pc.close();
          return;
        }
        const addr = (e.candidate as RTCIceCandidate & { address?: string }).address ?? e.candidate.candidate.split(" ")[4];
        if (addr && addr !== "0.0.0.0" && !addr.startsWith("127.") && !addr.includes(":")) {
          ips.add(addr);
        }
      };
      // Timeout — fall back to whatever we have
      setTimeout(() => {
        const ipv4 = Array.from(ips).find((ip) => ip.includes("."));
        resolve(ipv4 ?? ips.values().next().value ?? "0.0.0.0");
        pc.close();
      }, 5000);
    });
  }

  private hashString(str: string): string {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h).toString(16).toUpperCase();
  }

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
