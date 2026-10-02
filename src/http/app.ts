import { Hono } from "hono";
import { cors } from "hono/cors";
import { pingDatabase } from "../db/client.js";
import {
  confirmLead,
  createLead,
  getBusiness,
  getJob,
  getLead,
  searchOpportunities,
} from "../modules/catalog.js";
import { parseCreateLead, parseOrigin, parseSearch, parseVote } from "./parse.js";

function fail(error: string) {
  return { error: { code: "BAD_REQUEST", message: error } };
}

export function createApp() {
  const app = new Hono();
  const origin = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

  app.use(
    "*",
    cors({
      origin: origin.split(",").map((value) => value.trim()),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );

  app.get("/v1/health", async (c) => {
    await pingDatabase();
    return c.json({ ok: true, dataSource: "mock", database: "supabase" });
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
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const parsed = parseCreateLead(body);
    if ("error" in parsed) return c.json(fail(parsed.error), 400);
    return c.json(await createLead(parsed), 201);
  });

  app.post("/v1/leads/:id/confirmations", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const vote = parseVote(body);
    if (typeof vote !== "string") return c.json(fail(vote.error), 400);
    const lead = await confirmLead(c.req.param("id"), vote);
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
