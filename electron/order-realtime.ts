import type { PosDatabase } from "./database";
import { readSession } from "./session";

type RealtimeEvent = { type?: string; eventId?: string; orderId?: number; status?: string };

export class OrderRealtimeService {
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = true;
  private generation = 0;
  private connectedToken = "";
  private connected = false;
  private reconnectAttempt = 0;
  private readonly seenEventIds = new Set<string>();

  constructor(private readonly database: PosDatabase, private readonly onOrderEvent: (event: RealtimeEvent) => void) {}

  get isConnected() {
    return this.connected;
  }

  start() {
    if (!this.stopped) {
      this.restart();
      return;
    }
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.connect(++this.generation);
  }

  restartIfSessionChanged() {
    const token = readSession(this.database)?.accessToken ?? "";
    if (token && token !== this.connectedToken) this.restart();
  }

  restart() {
    if (this.stopped) return;
    this.generation += 1;
    this.clearReconnect();
    this.socket?.close(1000, "Session changed");
    this.socket = null;
    this.connected = false;
    this.connect(this.generation);
  }

  stop() {
    this.stopped = true;
    this.generation += 1;
    this.clearReconnect();
    this.socket?.close(1000, "Application closing");
    this.socket = null;
    this.connected = false;
    this.connectedToken = "";
    this.reconnectAttempt = 0;
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private scheduleReconnect(generation: number, delay?: number) {
    if (this.stopped || generation !== this.generation) return;
    this.clearReconnect();
    const backoff = delay ?? Math.min(60_000, 5000 * 2 ** this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => this.connect(generation), backoff + Math.floor(Math.random() * 1500));
  }

  private async connect(generation: number) {
    if (this.stopped || generation !== this.generation) return;
    try {
      const session = readSession(this.database);
      if (!session || session.user.role !== "PARTNER") {
        this.scheduleReconnect(generation, 15000);
        return;
      }
      if (generation !== this.generation || this.stopped) return;
      const endpoint = new URL(session.endpoint);
      endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(endpoint.toString(), "graphql-transport-ws");
      this.socket = socket;
      this.connectedToken = session.accessToken;
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "connection_init", payload: { authorization: `Bearer ${session.accessToken}` } }));
      }, { once: true });
      socket.addEventListener("message", (message) => {
        let frame: any;
        try { frame = JSON.parse(String(message.data)); } catch { return; }
        if (frame.type === "ping") {
          socket.send(JSON.stringify({ type: "pong", ...(frame.payload === undefined ? {} : { payload: frame.payload }) }));
        } else if (frame.type === "connection_ack") {
          this.connected = true;
          this.reconnectAttempt = 0;
          socket.send(JSON.stringify({ id: "pos-order-events", type: "subscribe", payload: { query: "subscription PosOrderNotifications { notification }" } }));
        } else if (frame.type === "next" && frame.id === "pos-order-events") {
          const raw = frame.payload?.data?.notification;
          if (typeof raw !== "string") return;
          try {
            const event = JSON.parse(raw) as RealtimeEvent;
            if (event.type === "ORDER_UPDATED" && Number.isSafeInteger(event.orderId)) {
              if (event.eventId && this.seenEventIds.has(event.eventId)) return;
              if (event.eventId) {
                this.seenEventIds.add(event.eventId);
                if (this.seenEventIds.size > 1000) this.seenEventIds.delete(this.seenEventIds.values().next().value!);
              }
              this.onOrderEvent(event);
            }
          } catch {
            // Ignore unrelated notification payloads on the shared channel.
          }
        } else if (frame.type === "connection_error" || frame.type === "error") {
          socket.close(4401, "Realtime authentication failed");
        }
      });
      socket.addEventListener("close", () => {
        this.connected = false;
        if (this.socket === socket) this.socket = null;
        this.scheduleReconnect(generation);
      }, { once: true });
      socket.addEventListener("error", () => socket.close());
    } catch {
      this.scheduleReconnect(generation, 10000);
    }
  }
}
