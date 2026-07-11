/**
 * NetworkTransport — WebRTC peer-to-peer sync with MQTT signaling.
 *
 * Architecture:
 *   Each device joins an MQTT room derived from a hash of its public IP.
 *   Devices discover each other via presence messages, then establish
 *   a WebRTC DataChannel for direct P2P data transfer. Falls back to
 *   MQTT relay when P2P is slow or blocked.
 *
 * This module is stateful (holds connection state) but has no UI — it
 * emits callbacks so any UI layer can bind to it.
 */

import * as SyncProtocol from "./sync-protocol";
import { buildExportPayload, mergePayloadIntoStorage } from "./sync-helpers";

/* ── Types ──────────────────────────────────────────────────────────── */

export interface DeviceInfo {
  id: string;
  name: string;
  lastSeen: number;
  pullOnly: boolean;
}

export interface SyncRequest {
  fromId: string;
  fromName: string;
  type: "relay" | "p2p-data";
  preview: SyncProtocol.SyncPreview | null;
  data?: string;
  createdAt: number;
}

export type ConnectionStatus =
  | "disconnected"
  | "discovering"
  | "connecting"
  | "connected"
  | "error";

export interface TransportCallbacks {
  onDevicesChanged: (devices: DeviceInfo[]) => void;
  onStatusChanged: (status: ConnectionStatus, message: string) => void;
  onSyncRequest: (request: SyncRequest) => void;
  onSyncComplete: (method: "p2p" | "relay") => void;
  onTransferProgress: (bytesTransferred: number, totalBytes: number) => void;
  onRoomId: (roomId: string) => void;
}

/* ── Device identity ────────────────────────────────────────────────── */

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

/* ── Transport class ────────────────────────────────────────────────── */

export class NetworkTransport {
  readonly deviceId: string;
  deviceName: string;
  callbacks: TransportCallbacks;

  private mqttClient: unknown = null;
  private roomHash: string | null = null;
  private discovering = false;
  private connected = false;
  private devices: Record<string, DeviceInfo> = {};
  private peers: Record<string, RTCPeerConnection> = {};
  private dataChannels: Record<string, RTCDataChannel> = {};
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSyncs: Record<string, SyncRequest> = {};
  private iceQueues: Record<string, { pending: RTCIceCandidateInit[]; remoteSet: boolean }> = {};
  private relayUsedFor: Record<string, boolean> = {};
  private pullOnly = false;

  constructor(callbacks: TransportCallbacks) {
    this.callbacks = callbacks;
    this.deviceId = generateDeviceId();
    this.deviceName = generateDeviceName();
  }

  /* ── Public API ──────────────────────────────────────────────────── */

  get isConnected(): boolean {
    return this.connected;
  }

  get discoveredDevices(): DeviceInfo[] {
    return Object.values(this.devices);
  }

  get isPullOnly(): boolean {
    return this.pullOnly;
  }

  setPullOnly(val: boolean): void {
    this.pullOnly = val;
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("osler_sync_pull_only", val ? "true" : "false");
      } catch { /* ignore */ }
    }
    this.callbacks.onDevicesChanged(this.discoveredDevices);
    this.broadcastPresence();
  }

  async startDiscovery(): Promise<void> {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    if (this.mqttClient || this.discovering) return;
    this.discovering = true;
    this.callbacks.onStatusChanged("discovering", "Initializing discovery...");

    try {
      const ip = await this.getPublicIP();
      const hash = await this.hashString(`osler-sync-v2-${ip}`);
      this.roomHash = hash.substring(0, 8).toUpperCase();
      this.callbacks.onRoomId(this.roomHash);
      await this.connectMQTT();
    } catch (e) {
      this.callbacks.onStatusChanged("error", `Discovery failed: ${(e as Error).message}`);
      this.discovering = false;
    }
  }

  stopDiscovery(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const id of Object.keys(this.peers)) {
      this.disconnectPeer(id);
    }
    if (this.mqttClient) {
      try {
        (this.mqttClient as { disconnect: () => void }).disconnect();
      } catch { /* ignore */ }
      this.mqttClient = null;
    }
    this.connected = false;
    this.discovering = false;
    this.devices = {};
    this.callbacks.onDevicesChanged([]);
    this.callbacks.onStatusChanged("disconnected", "Discovery stopped");
  }

  async connectToDevice(deviceId: string): Promise<void> {
    const device = this.devices[deviceId];
    this.callbacks.onStatusChanged("connecting", `Connecting to ${device?.name ?? deviceId}...`);

    if (this.peers[deviceId]) {
      try { this.peers[deviceId].close(); } catch { /* ignore */ }
      delete this.peers[deviceId];
    }
    const pc = this.createPeerConnection(deviceId);
      const channel = pc.createDataChannel("sync");
      this.setupChannel(channel, deviceId, true);

    let relayFired = false;
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        relayFired = true;
        if (this.relayUsedFor[deviceId]) {
          try { pc.close(); } catch { /* ignore */ }
          delete this.peers[deviceId];
          return;
        }
        this.callbacks.onStatusChanged("connected", "P2P Established!");
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sendSignal(deviceId, { sdp: offer });

    // Relay fallback after 6 seconds
    setTimeout(() => {
      if (!relayFired && pc.connectionState !== "connected" && pc.iceConnectionState !== "connected") {
        relayFired = true;
        this.relayUsedFor[deviceId] = true;
        this.callbacks.onStatusChanged("connected", "P2P slow, using Relay...");
      }
    }, 6000);
  }

  sendRelaySync(targetId: string, data: string): void {
    if (!this.mqttClient) return;
    if (data.length > SyncProtocol.MQTT_RELAY_MAX) {
      this.callbacks.onStatusChanged("error", "Data too large for relay. Use QR or File sync instead.");
      return;
    }
    this.publishMessage(
      `osler/sync/v2/${this.roomHash}/relay/${targetId}`,
      JSON.stringify({
        type: "relay",
        sender: this.deviceId,
        target: targetId,
        data,
        isResponse: false,
      }),
    );
  }

  acceptSync(fromId: string): void {
    const pending = this.pendingSyncs[fromId];
    if (!pending) return;
    delete this.pendingSyncs[fromId];
    this.callbacks.onSyncComplete("relay");
  }

  declineSync(fromId: string): void {
    delete this.pendingSyncs[fromId];
    this.callbacks.onStatusChanged("error", "Sync declined");
  }

  exportData(exportFn: () => string): string {
    return exportFn();
  }

  /* ── MQTT ────────────────────────────────────────────────────────── */

  private async getPublicIP(): Promise<string> {
    return new Promise((resolve) => {
      try {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        pc.createDataChannel("");
        pc.createOffer().then((o) => pc.setLocalDescription(o));
        let found = false;
        const timeout = setTimeout(() => {
          if (!found) {
            found = true;
            resolve("offline");
            try { pc.close(); } catch { /* ignore */ }
          }
        }, 2500);
        pc.onicecandidate = (e) => {
          if (found || !e.candidate) return;
          const match = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/.exec(e.candidate.candidate);
          if (match && e.candidate.type === "srflx") {
            found = true;
            clearTimeout(timeout);
            resolve(match[1]);
            pc.close();
          }
        };
      } catch {
        resolve("offline");
      }
    });
  }

  private async hashString(str: string): Promise<string> {
    try {
      if (typeof crypto !== "undefined" && crypto.subtle) {
        const buf = new TextEncoder().encode(str);
        const hash = await crypto.subtle.digest("SHA-256", buf);
        return Array.from(new Uint8Array(hash))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }
    } catch { /* fall through */ }
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h).toString(16).padStart(8, "0");
  }

  private async connectMQTT(): Promise<void> {
    if (typeof window === "undefined") return;

    const mqttModule = await import("paho-mqtt");
    const PahoClient = mqttModule.default.Client;
    const PahoMessage = mqttModule.default.Message;

    const clientId = `osler-${this.deviceId}-${Math.floor(Math.random() * 10000)}`;
    const client = new PahoClient("broker.emqx.io", 8084, "/mqtt", clientId);

    this.mqttClient = client;
    this.callbacks.onStatusChanged("discovering", "Connecting to signaling network...");

    client.onConnectionLost = () => {
      this.mqttClient = null;
      this.discovering = false;
      this.devices = {};
      this.callbacks.onDevicesChanged([]);
      this.callbacks.onStatusChanged("disconnected", "Network lost");
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    };

    client.onMessageArrived = (message: { payloadString: string }) => {
      this.handleMQTTMessage(message.payloadString);
    };

    return new Promise<void>((resolve, reject) => {
      client.connect({
        useSSL: true,
        timeout: 5,
        keepAliveInterval: 30,
        onSuccess: () => {
          client.subscribe(`osler/sync/v2/${this.roomHash}/#`);
          this.discovering = false;
          this.connected = true;
          this.broadcastPresence();
          this.startHeartbeat();
          this.callbacks.onStatusChanged("discovering", "Scanning for devices...");
          resolve();
        },
        onFailure: (e: { errorCode: number; errorMessage: string }) => {
          this.callbacks.onStatusChanged("error", `Connection failed: ${e.errorMessage}`);
          reject(new Error(e.errorMessage));
        },
      });
    });
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => this.broadcastPresence(), 5000);
  }

  private broadcastPresence(): void {
    if (!this.mqttClient) return;
    this.publishMessage(
      `osler/sync/v2/${this.roomHash}/presence/${this.deviceId}`,
      JSON.stringify({
        type: "presence",
        id: this.deviceId,
        name: this.deviceName,
        pullOnly: this.pullOnly,
      }),
    );
  }

  private publishMessage(topic: string, payload: string): void {
    if (!this.mqttClient) return;
    try {
      import("paho-mqtt").then((mqtt) => {
        const msg = new mqtt.default.Message(payload);
        msg.destinationName = topic;
        (this.mqttClient as { send: (m: unknown) => void }).send(msg);
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  private handleMQTTMessage(payloadString: string): void {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(payloadString);
    } catch {
      return;
    }

    const type = payload.type as string;

    if (type === "presence" && payload.id !== this.deviceId) {
      this.devices[payload.id as string] = {
        id: payload.id as string,
        name: payload.name as string,
        lastSeen: Date.now(),
        pullOnly: !!payload.pullOnly,
      };
      this.callbacks.onDevicesChanged(this.discoveredDevices);
    } else if (type === "signal" && payload.target === this.deviceId) {
      this.handleSignal(payload);
    } else if (type === "relay" && payload.target === this.deviceId) {
      const fromId = payload.sender as string;
      if (this.pendingSyncs[fromId]) return;
      const preview = SyncProtocol.preview(payload.data as string);
      this.pendingSyncs[fromId] = {
        fromId,
        fromName: this.devices[fromId]?.name ?? "Unknown",
        type: "relay",
        preview,
        data: payload.data as string,
        createdAt: Date.now(),
      };
      this.callbacks.onSyncRequest(this.pendingSyncs[fromId]);
    }
  }

  /* ── WebRTC ──────────────────────────────────────────────────────── */

  private createPeerConnection(targetId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
      ],
    });
    this.peers[targetId] = pc;
    this.iceQueues[targetId] = { pending: [], remoteSet: false };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
        this.callbacks.onStatusChanged("error", "P2P connection failed");
        try { pc.close(); } catch { /* ignore */ }
        for (const k of Object.keys(this.peers)) {
          if (this.peers[k] === pc) {
            delete this.peers[k];
            break;
          }
        }
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSignal(targetId, { ice: e.candidate.toJSON() });
    };

    pc.ondatachannel = (e) => {
      this.setupChannel(e.channel, targetId, false);
    };

    return pc;
  }

  private handleSignal(payload: Record<string, unknown>): void {
    const fromId = payload.from as string;
    let pc = this.peers[fromId];
    if (!pc) pc = this.createPeerConnection(fromId);

    if (payload.sdp) {
      const sdp = payload.sdp as RTCSessionDescriptionInit;
      pc.setRemoteDescription(new RTCSessionDescription(sdp))
        .then(() => {
          if (this.iceQueues[fromId]) {
            this.iceQueues[fromId].remoteSet = true;
            const pending = this.iceQueues[fromId].pending;
            this.iceQueues[fromId].pending = [];
            for (const candidate of pending) {
              pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
            }
          }
          if (sdp.type === "offer") {
            pc.createAnswer().then((answer) => {
              pc.setLocalDescription(answer);
              this.sendSignal(fromId, { sdp: answer });
            });
          }
        })
        .catch((err) => console.warn("SetRemoteDescription failed:", err));
    } else if (payload.ice) {
      const ice = payload.ice as RTCIceCandidateInit;
      if (this.iceQueues[fromId] && !this.iceQueues[fromId].remoteSet) {
        this.iceQueues[fromId].pending.push(ice);
      } else {
        pc.addIceCandidate(new RTCIceCandidate(ice)).catch(() => {});
      }
    }
  }

  private sendSignal(targetId: string, data: Record<string, unknown>): void {
    this.publishMessage(
      `osler/sync/v2/${this.roomHash}/signal/${targetId}`,
      JSON.stringify({ type: "signal", from: this.deviceId, target: targetId, ...data }),
    );
  }

  private setupChannel(channel: RTCDataChannel, targetId: string, isInitiator: boolean): void {
    this.dataChannels[targetId] = channel;

    channel.onopen = () => {
      if (this.pullOnly) {
        this.callbacks.onStatusChanged("connected", "Listening for sync data...");
        return;
      }

      this.callbacks.onStatusChanged("connected", "Building export...");

      (async () => {
        try {
          const payload = await buildExportPayload();
          const wire = SyncProtocol.encode(payload);
          if (!wire) {
            this.callbacks.onStatusChanged("error", "No data to send");
            return;
          }

          channel.send(wire);
          this.callbacks.onTransferProgress(wire.length, wire.length);
          this.callbacks.onStatusChanged("connected", "Data sent successfully!");
        } catch (sendErr) {
          this.callbacks.onStatusChanged(
            "error",
            `Send failed: ${(sendErr as Error).message}`,
          );
        }
      })();
    };

    channel.onmessage = (e) => {
      const raw = e.data as string;
      if (!raw) return;

      if (raw === SyncProtocol.P2P_END || raw.startsWith(SyncProtocol.P2P_PREFIX)) return;

      this.callbacks.onStatusChanged("connected", "Receiving data...");

      (async () => {
        try {
          const payload = SyncProtocol.decode(raw);
          await mergePayloadIntoStorage(payload);
          this.callbacks.onSyncComplete("p2p");
        } catch (err) {
          this.callbacks.onStatusChanged("error", `Import failed: ${(err as Error).message}`);
        }
      })();
    };
  }

  private disconnectPeer(peerId: string): void {
    if (this.dataChannels[peerId]) {
      try { this.dataChannels[peerId].close(); } catch { /* ignore */ }
      delete this.dataChannels[peerId];
    }
    if (this.peers[peerId]) {
      try { this.peers[peerId].close(); } catch { /* ignore */ }
      delete this.peers[peerId];
    }
    delete this.relayUsedFor[peerId];
  }
}
