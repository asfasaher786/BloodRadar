import { Response } from "express";

// Server-Sent Events hub. ONE public, PII-free channel: any client can
// connect and listen, which means events must NEVER contain phone numbers,
// requester codes or other secrets. Events carry only enough to know WHAT
// changed (sos ids, statuses). Clients that are entitled to the details
// fetch them separately through the authenticated/requester-code endpoints.

interface SseClient {
  res: Response;
  id: number;
}

const clients = new Set<SseClient>();
let nextClientId = 1;
let heartbeat: NodeJS.Timeout | null = null;

const HEARTBEAT_MS = 25_000;

// P3a-4: open SSE connections are an unbounded per-client server resource
// (every tab holds one open stream). One script or a buggy client loop could
// hold hundreds. Cap concurrent streams per IP; the excess gets an honest
// 503 from the route. 10 is enough for any real user (a few tabs/devices
// behind the same NAT) while starving deliberate stream floods.
export const MAX_SSE_CONNECTIONS_PER_IP = 10;
const connectionsByIp = new Map<string, Set<SseClient>>();

function clientIp(res: Response): string {
  const ip = res.req?.ip || res.req?.socket?.remoteAddress || "unknown";
  // Express reports IPv4-mapped addresses as ::ffff:1.2.3.4 — normalize so
  // one client counts once.
  return ip.replace(/^::ffff:/, "");
}

function startHeartbeat(): void {
  heartbeat = setInterval(() => {
    for (const client of clients) {
      try {
        client.res.write(": ping\n\n");
      } catch {
        clients.delete(client);
      }
    }
  }, HEARTBEAT_MS);
}

function stopHeartbeat(): void {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

export function registerSseClient(res: Response): boolean {
  const ip = clientIp(res);
  const bucket = connectionsByIp.get(ip) ?? new Set<SseClient>();
  if (bucket.size >= MAX_SSE_CONNECTIONS_PER_IP) return false;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Proxies (nginx/Render) must not buffer the stream.
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  const client: SseClient = { res, id: nextClientId++ };
  clients.add(client);
  bucket.add(client);
  connectionsByIp.set(ip, bucket);
  if (!heartbeat) startHeartbeat();

  res.on("close", () => {
    clients.delete(client);
    bucket.delete(client);
    if (bucket.size === 0) connectionsByIp.delete(ip);
    if (clients.size === 0) stopHeartbeat();
  });
  return true;
}

// Event payloads must be PII-free. If you're tempted to include a phone
// number here, don't — this channel has no authentication.
export function broadcastEvent(type: string, data: unknown): void {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}
