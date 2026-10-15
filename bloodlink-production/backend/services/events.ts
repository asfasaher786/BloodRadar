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

export function registerSseClient(res: Response): void {
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
  if (!heartbeat) startHeartbeat();

  res.on("close", () => {
    clients.delete(client);
    if (clients.size === 0) stopHeartbeat();
  });
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
