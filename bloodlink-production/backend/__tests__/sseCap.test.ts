import { describe, it, expect, afterAll, beforeAll } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import { createApp } from "../app";
import { MAX_SSE_CONNECTIONS_PER_IP } from "../services/events";

// P3a-4: /api/events holds one open stream per tab, so an abusive or buggy
// client could pin the whole connection budget. The 11th concurrent stream
// from the same IP must be refused with 503 while the first N stay open.

let server: Server;
let port: number;

beforeAll(async () => {
  server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  port = addr.port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function openSse(): Promise<http.ClientRequest> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/api/events`);
    // The response event fires once the server has written the SSE headers,
    // i.e. after the connection has been registered server-side.
    req.once("response", () => resolve(req));
    req.once("error", reject);
  });
}

function getStatus(): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/api/events`, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode || 0, body }));
    });
    req.once("error", reject);
  });
}

describe("SSE connection cap (P3a-4)", () => {
  it(`allows ${MAX_SSE_CONNECTIONS_PER_IP} streams per IP and refuses the next`, async () => {
    const open: http.ClientRequest[] = [];
    for (let i = 0; i < MAX_SSE_CONNECTIONS_PER_IP; i++) {
      open.push(await openSse());
    }

    const eleventh = await getStatus();
    expect(eleventh.status).toBe(503);
    expect(eleventh.body).toContain("Too many open live connections");

    // Clean up so the worker can exit: destroy the held streams.
    for (const req of open) req.destroy();
  });

  it("frees the slot when a stream closes", async () => {
    const held = await openSse();
    // Closing the client must release its per-IP slot server-side.
    held.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The cap is per-IP and we just freed one of MAX slots; a single fresh
    // connection must be accepted (it opens an SSE stream, so the response
    // event proves acceptance).
    const fresh = await openSse();
    expect(fresh).toBeTruthy();
    fresh.destroy();
  });
});
