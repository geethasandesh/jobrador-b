import { Hono } from "hono";
import { cors } from "hono/cors";
import { pingDatabase } from "../db/client.js";
import {
  confirmLead,
  createLead,
  getBusiness,
  getJob,
  getLead,
  listingSource,
  searchOpportunities,
} from "../modules/catalog.js";
import { userFromRequest } from "./auth.js";
import { parseCreateLead, parseOrigin, parseSearch, parseVote } from "./parse.js";
import { listFeaturedNotes, noteForDevice, parseWallNote, reactToNote, stickNote } from "../modules/wall.js";
import { searchBerlinPlaces } from "../ingest/geocode.js";

function fail(error: string, code = "BAD_REQUEST") {
  return { error: { code, message: error } };
}

export function createApp() {
  const app = new Hono();
  const origin = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

  app.use(
    "*",
    cors({
      origin: origin.split(",").map((value) => value.trim()),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.get("/v1/health", async (c) => {
    await pingDatabase();
    return c.json({ ok: true, dataSource: await listingSource(), database: "supabase" });
  });

  app.get("/v1/places", async (c) => {
    const query = c.req.query("q")?.trim() ?? "";
    return c.json({ places: await searchBerlinPlaces(query) });
  });

  app.get("/v1/opportunities", async (c) => {
    const parsed = parseSearch(new URL(c.req.url));
    if ("error" in parsed) return c.json(fail(parsed.error), 400);
    return c.json(await searchOpportunities(parsed));
  });

  app.get("/v1/jobs/:id", async (c) => {
    const originPoint = parseOrigin(new URL(c.req.url));
    if (originPoint && "error" in originPoint) return c.json(fail(originPoint.error), 400);
    const job = await getJob(c.req.param("id"), originPoint);
    if (!job) {
      return c.json({ error: { code: "NOT_FOUND", message: "Job not found" } }, 404);
    }
    return c.json(job);
  });

  app.get("/v1/leads/:id", async (c) => {
    const originPoint = parseOrigin(new URL(c.req.url));
    if (originPoint && "error" in originPoint) return c.json(fail(originPoint.error), 400);
    const lead = await getLead(c.req.param("id"), originPoint);
    if (!lead) {
      return c.json({ error: { code: "NOT_FOUND", message: "Community lead not found" } }, 404);
    }
    return c.json(lead);
  });

  app.get("/v1/businesses/:id", async (c) => {
    const originPoint = parseOrigin(new URL(c.req.url));
    if (originPoint && "error" in originPoint) return c.json(fail(originPoint.error), 400);
    const business = await getBusiness(c.req.param("id"), originPoint);
    if (!business) {
      return c.json({ error: { code: "NOT_FOUND", message: "Business not found" } }, 404);
    }
    return c.json(business);
  });

  app.post("/v1/leads", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to share a tip.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const parsed = parseCreateLead(body);
    if ("error" in parsed) return c.json(fail(parsed.error), 400);
    const created = await createLead({ ...parsed, accountId: user.id });
    if ("error" in created) {
      return c.json(fail(created.error, created.status === 429 ? "TOO_MANY" : "BAD_REQUEST"), created.status as 429);
    }
    return c.json(created, 201);
  });

  app.get("/v1/wall", async (c) => {
    const deviceId = new URL(c.req.url).searchParams.get("deviceId") ?? "";
    const notes = await listFeaturedNotes(deviceId);
    return c.json({
      notes: notes.map(({ status: _status, ...note }) => note),
    });
  });

  app.get("/v1/wall/mine", async (c) => {
    const deviceId = new URL(c.req.url).searchParams.get("deviceId") ?? "";
    return c.json({ note: await noteForDevice(deviceId) });
  });

  app.post("/v1/wall", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const parsed = parseWallNote(body);
    if ("error" in parsed) return c.json(fail(parsed.error), 400);
    const note = await stickNote(parsed);
    if ("error" in note) return c.json(fail(note.error, note.status === 409 ? "CONFLICT" : "BAD_REQUEST"), note.status as 409);
    return c.json(note, 201);
  });

  app.post("/v1/wall/:id/reactions", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const deviceId = typeof record.deviceId === "string" ? record.deviceId : "";
    const emoji = typeof record.emoji === "string" ? record.emoji : "";
    const reactions = await reactToNote(c.req.param("id"), deviceId, emoji);
    if ("error" in reactions) return c.json(fail(reactions.error), reactions.status as 400);
    return c.json({ reactions });
  });

  app.post("/v1/leads/:id/confirmations", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to update a tip.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const vote = parseVote(body);
    if (typeof vote !== "string") return c.json(fail(vote.error), 400);
    const lead = await confirmLead(c.req.param("id"), vote, user.id);
    if (!lead) {
      return c.json({ error: { code: "NOT_FOUND", message: "Community lead not found" } }, 404);
    }
    return c.json(lead);
  });

  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404),
  );

  return app;
}
