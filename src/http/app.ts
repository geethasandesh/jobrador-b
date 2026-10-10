import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadEnvFile } from "../db/env.js";
import { pingDatabase } from "../db/client.js";
import {
  confirmLead,
  createLead,
  listMyPosts,
  manageOwnedLead,
  getBusiness,
  getJob,
  getLead,
  listingSource,
  searchOpportunities,
} from "../modules/catalog.js";
import { isAdminEmail, optionalUser, userFromRequest } from "./auth.js";
import { parseCreateLead, parseOrigin, parseSearch, parseVote } from "./parse.js";
import { listFeaturedNotes, noteForDevice, parseWallNote, reactToNote, stickNote } from "../modules/wall.js";
import {
  createReferral,
  listReferralQueue,
  listReferrals,
  parseReferral,
  pendingCount,
  reviewReferral,
} from "../modules/referrals.js";
import { createConfirmedAccount } from "../auth/accounts.js";
import { sendBugReport, sendPasswordReset } from "../email/mail.js";
import { adminOverview, saveBugReport } from "../modules/admin.js";
import { addVisit, mergeLibrary, readLibrary, removeVisit, setSaved } from "../modules/library.js";
import { listAreaAlerts, removeAreaAlert, saveAreaAlert } from "../modules/hiring-mail.js";
import {
  adminPlaces,
  listAdminNotes,
  listAdminPosts,
  listClosures,
  markBugHandled,
  myClosure,
  reportClosed,
  reviewClosure,
  setNoteHidden,
  setPostHidden,
} from "../modules/moderation.js";
import { searchBerlinPlaces } from "../ingest/geocode.js";
import { runIngest } from "../ingest/run.js";

function fail(error: string, code = "BAD_REQUEST") {
  return { error: { code, message: error } };
}

const recentHits = new Map<string, number[]>();

function limited(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const recent = (recentHits.get(key) ?? []).filter((time) => now - time < windowMs);
  if (recent.length >= max) return true;
  recent.push(now);
  recentHits.set(key, recent);
  return false;
}

function clientAddress(header: string | undefined) {
  return header?.split(",")[0]?.trim() || "local";
}

function allowedBrowserOrigins() {
  const fromEnv = (process.env.FRONTEND_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((value) => value.trim().replace(/^['"]|['"]$/g, "").replace(/\/$/, ""))
    .filter(Boolean);
  return new Set([
    ...fromEnv,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://jobrador-f.vercel.app",
    "https://jobrador.online",
    "https://www.jobrador.online",
  ]);
}

function isJobradorHost(host: string) {
  return host === "jobrador.online"
    || host === "www.jobrador.online"
    || host === "jobrador-f.vercel.app"
    || (host.startsWith("jobrador-f") && host.endsWith(".vercel.app"));
}

function allowBrowserOrigin(requestOrigin: string) {
  const origin = requestOrigin.trim().replace(/\/$/, "");
  if (!origin) return null;
  if (allowedBrowserOrigins().has(origin)) return origin;
  try {
    if (isJobradorHost(new URL(origin).host)) return origin;
  } catch {
    return null;
  }
  return null;
}

function readEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim() : "";
  if (!email.includes("@") || email.length > 200 || /[\r\n]/.test(email)) return null;
  return email;
}

function cronAuthorized(header: string | undefined) {
  loadEnvFile();
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!secret || token.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}

export function createApp() {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (requestOrigin) => allowBrowserOrigin(requestOrigin),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }),
  );

  app.get("/", (c) => c.text("jobrador API is running."));

  app.get("/v1/health", async (c) => {
    await pingDatabase();
    return c.json({ ok: true, dataSource: await listingSource(), database: "supabase" });
  });

  app.get("/v1/places", async (c) => {
    const query = c.req.query("q")?.trim() ?? "";
    return c.json(await searchBerlinPlaces(query));
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

  app.get("/v1/me/leads", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to see your posts.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    return c.json({ leads: await listMyPosts(user.id) });
  });

  app.get("/v1/leads/:id", async (c) => {
    const originPoint = parseOrigin(new URL(c.req.url));
    if (originPoint && "error" in originPoint) return c.json(fail(originPoint.error), 400);
    const accountId = await optionalUser(c.req.header("Authorization"));
    const lead = await getLead(c.req.param("id"), originPoint, accountId);
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

  app.post("/v1/leads/:id/manage", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to manage a post.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const action = body && typeof body === "object" ? (body as { action?: unknown }).action : null;
    if (action !== "stop" && action !== "delete" && action !== "reopen") {
      return c.json(fail("action must be stop, delete, or reopen"), 400);
    }
    const id = c.req.param("id");
    if (!id) return c.json(fail("Post not found.", "NOT_FOUND"), 404);
    const result = await manageOwnedLead(id, user.id, action);
    if ("error" in result) {
      const code = result.status === 403 ? "FORBIDDEN" : result.status === 404 ? "NOT_FOUND" : "BAD_REQUEST";
      return c.json(fail(result.error ?? "Could not update that post.", code), result.status as 400 | 403 | 404);
    }
    return c.json(result);
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

  app.post("/v1/auth/signup", async (c) => {
    const address = clientAddress(c.req.header("x-forwarded-for"));
    if (limited(`signup:${address}`, 8, 60 * 60 * 1000)) {
      return c.json(fail("Too many new accounts from this network. Try again later.", "TOO_MANY"), 429);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const record = body && typeof body === "object" ? (body as { email?: unknown; password?: unknown }) : {};
    const email = readEmail(record.email);
    const password = typeof record.password === "string" ? record.password : "";
    if (!email) return c.json(fail("Use an email address."), 400);
    if (password.length < 8 || password.length > 72) {
      return c.json(fail("Use a password of at least 8 characters."), 400);
    }
    const created = await createConfirmedAccount(email, password);
    if ("error" in created && created.error) {
      const status = created.error.includes("already") ? 409 : 503;
      return c.json(fail(created.error, status === 409 ? "CONFLICT" : "UNAVAILABLE"), status);
    }
    return c.json({ ok: true });
  });

  app.post("/v1/auth/forgot-password", async (c) => {
    const address = clientAddress(c.req.header("x-forwarded-for"));
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const email = readEmail(body && typeof body === "object" ? (body as { email?: unknown }).email : "");
    if (!email) return c.json(fail("Use the email on the account."), 400);
    if (limited(`reset:${email}:${address}`, 3, 60 * 60 * 1000)) {
      return c.json(fail("Too many reset emails. Try again later.", "TOO_MANY"), 429);
    }
    const sent = await sendPasswordReset(email, c.req.header("origin"));
    if ("error" in sent && sent.error) return c.json(fail(sent.error, "UNAVAILABLE"), 503);
    return c.json({ ok: true });
  });

  app.post("/v1/bugs", async (c) => {
    const address = clientAddress(c.req.header("x-forwarded-for"));
    if (limited(`bug:${address}`, 5, 60 * 60 * 1000)) {
      return c.json(fail("Too many bug reports. Try again later.", "TOO_MANY"), 429);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const message = typeof record.message === "string" ? record.message.trim() : "";
    if (message.length < 10 || message.length > 2000) {
      return c.json(fail("Describe the bug in 10 to 2000 characters."), 400);
    }
    let replyTo: string | undefined;
    if (record.email != null && record.email !== "") {
      const parsed = readEmail(record.email);
      if (!parsed) return c.json(fail("That email address does not look right."), 400);
      replyTo = parsed;
    }
    const page = typeof record.page === "string" ? record.page.trim().slice(0, 200) : "";
    try {
      await saveBugReport({ message, email: replyTo, page });
    } catch {
      return c.json(fail("The bug report could not be saved.", "UNAVAILABLE"), 503);
    }
    await sendBugReport({ message, email: replyTo, page });
    return c.json({ ok: true });
  });

  app.get("/v1/admin/overview", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to open the admin dashboard.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    if (!isAdminEmail(user.email)) return c.json(fail("This account cannot open the admin dashboard.", "FORBIDDEN"), 403);
    return c.json(await adminOverview(user.id));
  });

  app.get("/v1/referrals", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to read referrals.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    const admin = isAdminEmail(user.email);
    return c.json({
      referrals: await listReferrals(user.id),
      admin,
      pendingCount: admin ? await pendingCount() : 0,
    });
  });

  app.post("/v1/referrals", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to send a referral.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    if (limited(`referral:${user.id}`, 8, 60 * 60 * 1000)) {
      return c.json(fail("Too many referrals from this account. Try again later.", "TOO_MANY"), 429);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const parsed = parseReferral(body);
    if ("error" in parsed) return c.json(fail(parsed.error), 400);
    const created = await createReferral(user.id, user.email, parsed);
    if ("error" in created) {
      return c.json(fail(created.error, created.status === 429 ? "TOO_MANY" : "BAD_REQUEST"), created.status as 429 | 400 | 500);
    }
    return c.json(created, 201);
  });

  app.get("/v1/referrals/queue", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to review referrals.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    if (!isAdminEmail(user.email)) return c.json(fail("Only an admin can review referrals.", "FORBIDDEN"), 403);
    return c.json(await listReferralQueue(user.id));
  });

  app.post("/v1/referrals/:id/review", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to review referrals.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    if (!isAdminEmail(user.email)) return c.json(fail("Only an admin can review referrals.", "FORBIDDEN"), 403);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const action = body && typeof body === "object" ? (body as { action?: unknown }).action : null;
    if (action !== "approve" && action !== "reject") return c.json(fail("action must be approve or reject"), 400);
    const id = c.req.param("id");
    if (!id) return c.json(fail("That referral is not in the queue.", "NOT_FOUND"), 404);
    const updated = await reviewReferral(id, user.id, action);
    if ("error" in updated) {
      return c.json(fail(updated.error, updated.status === 404 ? "NOT_FOUND" : "BAD_REQUEST"), updated.status as 404 | 400);
    }
    return c.json(updated);
  });

  app.get("/v1/library", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to see saved jobs.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    return c.json(await readLibrary(user.id));
  });

  app.post("/v1/library/merge", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to save a job.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const record = body && typeof body === "object" ? (body as { saved?: unknown; visits?: unknown }) : {};
    return c.json(await mergeLibrary(user.id, record));
  });

  app.post("/v1/library/saved", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to save a job.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const record = body && typeof body === "object" ? (body as { id?: unknown; saved?: unknown; kind?: unknown }) : {};
    const kind = record.kind === "job" || record.kind === "community_lead" || record.kind === "nearby_business" ? record.kind : null;
    const updated = await setSaved(user.id, typeof record.id === "string" ? record.id : "", record.saved !== false, kind);
    if ("error" in updated && updated.error) return c.json(fail(updated.error), 400);
    return c.json(updated);
  });

  app.post("/v1/library/visits", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to keep a visit list.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const updated = await addVisit(user.id, body);
    if ("error" in updated && updated.error) return c.json(fail(updated.error), 400);
    return c.json(updated);
  });

  app.delete("/v1/library/visits/:id", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to keep a visit list.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    const updated = await removeVisit(user.id, c.req.param("id") ?? "");
    if ("error" in updated && updated.error) return c.json(fail(updated.error), 400);
    return c.json(updated);
  });

  app.get("/v1/area-alerts", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in so we can email you.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    return c.json({ alerts: await listAreaAlerts(user.id) });
  });

  app.post("/v1/area-alerts", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in so we can email you.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const record = body && typeof body === "object" ? (body as { label?: unknown; latitude?: unknown; longitude?: unknown; radiusKm?: unknown }) : {};
    const saved = await saveAreaAlert(user.id, {
      label: typeof record.label === "string" ? record.label : "",
      latitude: Number(record.latitude),
      longitude: Number(record.longitude),
      radiusKm: Number(record.radiusKm),
    });
    if ("error" in saved && saved.error) return c.json(fail(saved.error), 400);
    return c.json(saved);
  });

  app.delete("/v1/area-alerts/:id", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in so we can email you.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    return c.json(await removeAreaAlert(user.id, decodeURIComponent(c.req.param("id") ?? "")));
  });

  app.get("/v1/closures", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to report a closed posting.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    const jobId = c.req.query("jobId") ?? "";
    return c.json({ report: await myClosure(user.id, jobId) });
  });

  app.post("/v1/closures", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to report a closed posting.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    if (limited(`close:${user.id}`, 10, 24 * 60 * 60 * 1000)) {
      return c.json(fail("Too many closure reports today.", "TOO_MANY"), 429);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const jobId = body && typeof body === "object" ? (body as { jobId?: unknown }).jobId : "";
    if (typeof jobId !== "string" || !jobId) return c.json(fail("That posting is not on the map."), 400);
    const created = await reportClosed(user.id, jobId);
    if ("error" in created) {
      const status = created.status === 429 ? 429 : created.status === 404 ? 404 : 400;
      return c.json(fail(created.error, status === 429 ? "TOO_MANY" : "BAD_REQUEST"), status);
    }
    return c.json(created, 201);
  });

  app.get("/v1/admin/places", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to open the admin dashboard.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    if (!isAdminEmail(user.email)) return c.json(fail("This account cannot open the admin dashboard.", "FORBIDDEN"), 403);
    return c.json(await adminPlaces(c.req.query("tone"), c.req.query("q") ?? ""));
  });

  app.get("/v1/admin/posts", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to open the admin dashboard.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    if (!isAdminEmail(user.email)) return c.json(fail("This account cannot open the admin dashboard.", "FORBIDDEN"), 403);
    return c.json({ posts: await listAdminPosts() });
  });

  app.post("/v1/admin/posts/:id", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to open the admin dashboard.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    if (!isAdminEmail(user.email)) return c.json(fail("This account cannot open the admin dashboard.", "FORBIDDEN"), 403);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const hidden = body && typeof body === "object" ? (body as { hidden?: unknown }).hidden : null;
    if (typeof hidden !== "boolean") return c.json(fail("hidden must be true or false"), 400);
    const updated = await setPostHidden(c.req.param("id") ?? "", hidden);
    if ("error" in updated && updated.error) return c.json(fail(updated.error, "NOT_FOUND"), updated.status ?? 400);
    return c.json(updated);
  });

  app.get("/v1/admin/wall", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to open the admin dashboard.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    if (!isAdminEmail(user.email)) return c.json(fail("This account cannot open the admin dashboard.", "FORBIDDEN"), 403);
    return c.json({ notes: await listAdminNotes() });
  });

  app.post("/v1/admin/wall/:id", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to open the admin dashboard.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    if (!isAdminEmail(user.email)) return c.json(fail("This account cannot open the admin dashboard.", "FORBIDDEN"), 403);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const hidden = body && typeof body === "object" ? (body as { hidden?: unknown }).hidden : null;
    if (typeof hidden !== "boolean") return c.json(fail("hidden must be true or false"), 400);
    const updated = await setNoteHidden(c.req.param("id") ?? "", hidden);
    if ("error" in updated && updated.error) return c.json(fail(updated.error, "NOT_FOUND"), updated.status ?? 400);
    return c.json(updated);
  });

  app.post("/v1/admin/bugs/:id/handle", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to open the admin dashboard.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    if (!isAdminEmail(user.email)) return c.json(fail("This account cannot open the admin dashboard.", "FORBIDDEN"), 403);
    const updated = await markBugHandled(c.req.param("id") ?? "");
    if ("error" in updated && updated.error) return c.json(fail(updated.error, "NOT_FOUND"), updated.status ?? 400);
    return c.json(updated);
  });

  app.get("/v1/admin/closures", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to open the admin dashboard.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    if (!isAdminEmail(user.email)) return c.json(fail("This account cannot open the admin dashboard.", "FORBIDDEN"), 403);
    return c.json(await listClosures());
  });

  app.post("/v1/admin/closures/:id/review", async (c) => {
    const user = await userFromRequest(c.req.header("Authorization"), "Log in to open the admin dashboard.");
    if ("message" in user) return c.json(fail(user.message, "UNAUTHORIZED"), user.status as 401);
    if (!isAdminEmail(user.email)) return c.json(fail("This account cannot open the admin dashboard.", "FORBIDDEN"), 403);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(fail("Expected JSON"), 400);
    }
    const action = body && typeof body === "object" ? (body as { action?: unknown }).action : null;
    if (action !== "confirm" && action !== "dismiss") return c.json(fail("action must be confirm or dismiss"), 400);
    const updated = await reviewClosure(c.req.param("id") ?? "", action);
    if ("error" in updated && updated.error) return c.json(fail(updated.error, "NOT_FOUND"), updated.status ?? 400);
    return c.json(updated);
  });

  app.get("/v1/ingest", async (c) => {
    if (!cronAuthorized(c.req.header("Authorization"))) {
      return c.json(fail("This ingest run is not authorized.", "UNAUTHORIZED"), 401);
    }
    try {
      return c.json(await runIngest());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ingest failed";
      return c.json(fail(message), 500);
    }
  });

  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404),
  );

  return app;
}
