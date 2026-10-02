import { Hono } from "hono";
import { cors } from "hono/cors";
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

  app.get("/v1/health", (c) => c.json({ ok: true, dataSource: "mock" }));

  app.get("/v1/opportunities", (c) => {
    const parsed = parseSearch(new URL(c.req.url));
    if ("error" in parsed) return c.json(fail(parsed.error), 400);
    return c.json(searchOpportunities(parsed));
  });

  app.get("/v1/jobs/:id", (c) => {
    const originPoint = parseOrigin(new URL(c.req.url));
    if (originPoint && "error" in originPoint) return c.json(fail(originPoint.error), 400);
    const job = getJob(c.req.param("id"), originPoint);
    if (!job) {
      return c.json({ error: { code: "NOT_FOUND", message: "Job not found" } }, 404);
    }
    return c.json(job);
  });

  app.get("/v1/leads/:id", (c) => {
    const originPoint = parseOrigin(new URL(c.req.url));
    if (originPoint && "error" in originPoint) return c.json(fail(originPoint.error), 400);
    const lead = getLead(c.req.param("id"), originPoint);
    if (!lead) {
      return c.json({ error: { code: "NOT_FOUND", message: "Community lead not found" } }, 404);
    }
    return c.json(lead);
  });

  app.get("/v1/businesses/:id", (c) => {
    const originPoint = parseOrigin(new URL(c.req.url));
    if (originPoint && "error" in originPoint) return c.json(fail(originPoint.error), 400);
    const business = getBusiness(c.req.param("id"), originPoint);
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
    return c.json(createLead(parsed), 201);
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
    const lead = confirmLead(c.req.param("id"), vote);
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
