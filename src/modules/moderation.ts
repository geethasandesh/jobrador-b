import { randomBytes } from "node:crypto";
import { getSql } from "../db/client.js";
import { distanceKm } from "../lib/geo.js";
import { samePlaceName } from "../lib/place-name.js";

const DOOR_MATCH_KM = 2;

export type PlaceTone = "unchecked" | "hiring" | "empty" | "tip";

export type AdminPlace = {
  id: string;
  tone: PlaceTone;
  name: string;
  area: string | null;
  address: string;
  detail: string;
  href: string;
};

type BusinessRow = {
  id: string;
  name: string;
  area: string | null;
  address: string;
  source: string;
  hiring_checked_at: Date | string | null;
  latitude: number;
  longitude: number;
};

type JobRow = {
  id: string;
  business_id: string;
  title: string;
  latitude: number;
  longitude: number;
  company: string;
};

function isJobSeeker(title: string) {
  return /^(?:suche|sucht)\b/i.test(title) || /\bsucht\s+(?:einen\s+|eine\s+|ein\s+)?mini-?job/i.test(title);
}

function asTone(value: string | undefined): PlaceTone {
  if (value === "hiring" || value === "empty" || value === "tip") return value;
  return "unchecked";
}

export async function adminPlaces(toneValue: string | undefined, query: string) {
  const tone = asTone(toneValue);
  const needle = query.trim().toLowerCase();
  const db = getSql();
  const [businesses, jobs, tips, tipCount] = await Promise.all([
    db<BusinessRow[]>`
      select id, name, area, address, source, hiring_checked_at, latitude, longitude
      from businesses
    `,
    db<JobRow[]>`
      select j.id, j.business_id, j.title, j.latitude, j.longitude, b.name as company
      from jobs j
      join businesses b on b.id = j.business_id
      where j.status = 'ACTIVE'
    `,
    db<{ id: string; business_name: string; title: string; area: string | null; address: string }[]>`
      select id, business_name, title, area, address
      from community_leads
      where status = 'ACTIVE' and poster = 'student'
      order by created_at desc
      limit 80
    `,
    db<{ count: number }[]>`
      select count(*)::int as count from community_leads
      where status = 'ACTIVE' and poster = 'student'
    `,
  ]);

  const openJobs = jobs.filter((job) => !isJobSeeker(job.title));
  const jobsByBusiness = new Map<string, JobRow[]>();
  for (const job of openJobs) {
    const list = jobsByBusiness.get(job.business_id) ?? [];
    list.push(job);
    jobsByBusiness.set(job.business_id, list);
  }
  const hiringIds = new Set(jobsByBusiness.keys());
  const employers = businesses.filter((business) => hiringIds.has(business.id) && business.source !== "osm" && business.source !== "mock");
  for (const place of businesses) {
    if (place.source !== "osm" && place.source !== "mock") continue;
    if (hiringIds.has(place.id)) continue;
    for (const employer of employers) {
      if (!samePlaceName(employer.name, place.name)) continue;
      if (distanceKm(employer.latitude, employer.longitude, place.latitude, place.longitude) > DOOR_MATCH_KM) continue;
      hiringIds.add(place.id);
      const linked = jobsByBusiness.get(employer.id);
      if (linked) jobsByBusiness.set(place.id, linked);
      break;
    }
  }

  const counts = { unchecked: 0, hiring: 0, empty: 0, tip: tipCount[0]?.count ?? 0 };
  const rows: AdminPlace[] = [];
  for (const business of businesses) {
    const linked = jobsByBusiness.get(business.id) ?? [];
    const placeTone: PlaceTone = hiringIds.has(business.id) ? "hiring" : business.hiring_checked_at ? "empty" : "unchecked";
    counts[placeTone] += 1;
    if (tone === "tip" || placeTone !== tone) continue;
    const haystack = `${business.name} ${business.area ?? ""} ${business.address}`.toLowerCase();
    if (needle && !haystack.includes(needle)) continue;
    rows.push({
      id: business.id,
      tone: placeTone,
      name: business.name,
      area: business.area,
      address: business.address,
      detail: placeTone === "hiring" ? (linked[0]?.title ?? "Public posting") : placeTone === "empty" ? "No public vacancy found" : "Not checked yet",
      href: placeTone === "hiring" && linked[0] ? `/jobs/${linked[0].id}` : `/businesses/${business.id}`,
    });
  }

  if (tone === "tip") {
    for (const tip of tips) {
      const haystack = `${tip.business_name} ${tip.title} ${tip.area ?? ""}`.toLowerCase();
      if (needle && !haystack.includes(needle)) continue;
      rows.push({
        id: tip.id,
        tone: "tip",
        name: tip.business_name,
        area: tip.area,
        address: tip.address,
        detail: tip.title,
        href: `/leads/${tip.id}`,
      });
    }
  }

  return { tone, counts, places: rows.slice(0, 80) };
}

export type AdminPost = {
  id: string;
  poster: "student" | "business";
  name: string;
  title: string;
  area: string | null;
  hidden: boolean;
  createdAt: string;
};

export async function listAdminPosts() {
  const rows = await getSql()<{
    id: string;
    poster: "student" | "business";
    business_name: string;
    title: string;
    area: string | null;
    status: string;
    hidden_at: Date | string | null;
    created_at: Date | string;
  }[]>`
    select id, poster, business_name, title, area, status, hidden_at, created_at
    from community_leads
    where status = 'ACTIVE' or hidden_at is not null
    order by created_at desc
    limit 120
  `;
  return rows.map((row) => ({
    id: row.id,
    poster: row.poster === "business" ? "business" as const : "student" as const,
    name: row.business_name,
    title: row.title,
    area: row.area,
    hidden: row.status !== "ACTIVE",
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function setPostHidden(id: string, hidden: boolean) {
  const db = getSql();
  if (hidden) {
    const rows = await db<{ id: string }[]>`
      update community_leads
      set status = 'REMOVED', hidden_at = now(), updated_at = now()
      where id = ${id} and status = 'ACTIVE'
      returning id
    `;
    if (!rows[0]) return { error: "That post is not on the map.", status: 404 as const };
    return { ok: true as const };
  }
  const rows = await db<{ id: string }[]>`
    update community_leads
    set status = 'ACTIVE', hidden_at = null, updated_at = now()
    where id = ${id} and hidden_at is not null
    returning id
  `;
  if (!rows[0]) return { error: "That post is not hidden.", status: 404 as const };
  return { ok: true as const };
}

export type AdminWallNote = {
  id: string;
  displayName: string;
  body: string;
  hidden: boolean;
  createdAt: string;
};

export async function listAdminNotes() {
  const rows = await getSql()<{
    id: string;
    display_name: string;
    body: string;
    status: string;
    created_at: Date | string;
  }[]>`
    select id, display_name, body, status, created_at
    from wall_notes
    where status in ('approved', 'rejected')
    order by created_at desc
    limit 120
  `;
  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    body: row.body,
    hidden: row.status !== "approved",
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function setNoteHidden(id: string, hidden: boolean) {
  const status = hidden ? "rejected" : "approved";
  const rows = await getSql()<{ id: string }[]>`
    update wall_notes
    set status = ${status}
    where id = ${id} and status in ('approved', 'rejected')
    returning id
  `;
  if (!rows[0]) return { error: "That note is not on the wall.", status: 404 as const };
  return { ok: true as const };
}

export async function markBugHandled(id: string) {
  const rows = await getSql()<{ id: string }[]>`
    update bug_reports
    set handled_at = now()
    where id = ${id} and handled_at is null
    returning id
  `;
  if (!rows[0]) return { error: "That report is already handled.", status: 404 as const };
  return { ok: true as const };
}

export type ClosureReport = {
  id: string;
  jobId: string;
  placeName: string;
  jobTitle: string;
  status: "pending" | "confirmed" | "dismissed";
  createdAt: string;
};

export async function myClosure(accountId: string, jobId: string): Promise<ClosureReport | null> {
  const rows = await getSql()<{
    id: string;
    job_id: string;
    place_name: string;
    job_title: string;
    status: ClosureReport["status"];
    created_at: Date | string;
  }[]>`
    select id, job_id, place_name, job_title, status, created_at
    from closure_reports
    where account_id = ${accountId} and job_id = ${jobId}
    order by created_at desc
    limit 1
  `;
  return rows[0] ? toClosure(rows[0]) : null;
}

export async function reportClosed(accountId: string, jobId: string) {
  const db = getSql();
  const jobs = await db<{ id: string; title: string; business_id: string; status: string; company: string }[]>`
    select j.id, j.title, j.business_id, j.status, b.name as company
    from jobs j
    join businesses b on b.id = j.business_id
    where j.id = ${jobId}
    limit 1
  `;
  const job = jobs[0];
  if (!job || job.status !== "ACTIVE" || isJobSeeker(job.title)) {
    return { error: "That posting is not on the map.", status: 404 as const };
  }
  const existing = await db<{ id: string }[]>`
    select id from closure_reports
    where account_id = ${accountId} and job_id = ${jobId} and status = 'pending'
    limit 1
  `;
  if (existing[0]) {
    const current = await myClosure(accountId, jobId);
    return current ?? { error: "That report is already waiting.", status: 409 as const };
  }
  const today = await db<{ count: number }[]>`
    select count(*)::int as count from closure_reports
    where account_id = ${accountId} and created_at > now() - interval '1 day'
  `;
  if ((today[0]?.count ?? 0) >= 10) {
    return { error: "Too many closure reports today.", status: 429 as const };
  }
  const id = `close_${randomBytes(8).toString("hex")}`;
  const rows = await db<Parameters<typeof toClosure>[0][]>`
    insert into closure_reports (id, account_id, job_id, business_id, place_name, job_title)
    values (${id}, ${accountId}, ${job.id}, ${job.business_id}, ${job.company}, ${job.title})
    returning id, job_id, place_name, job_title, status, created_at
  `;
  const created = rows[0];
  if (!created) return { error: "The report could not be saved.", status: 500 as const };
  return toClosure(created);
}

export async function listClosures() {
  const rows = await getSql()<{
    id: string;
    job_id: string;
    place_name: string;
    job_title: string;
    status: ClosureReport["status"];
    created_at: Date | string;
  }[]>`
    select id, job_id, place_name, job_title, status, created_at
    from closure_reports
    order by created_at desc
    limit 80
  `;
  const reports = rows.map(toClosure);
  return {
    pending: reports.filter((report) => report.status === "pending"),
    history: reports.filter((report) => report.status !== "pending"),
  };
}

export async function reviewClosure(id: string, action: "confirm" | "dismiss") {
  const db = getSql();
  const rows = await db<{ id: string; job_id: string; business_id: string | null; status: string }[]>`
    select id, job_id, business_id, status from closure_reports where id = ${id} limit 1
  `;
  const report = rows[0];
  if (!report || report.status !== "pending") return { error: "That report is not waiting.", status: 404 as const };
  if (action === "confirm") {
    await db`update jobs set status = 'EXPIRED', updated_at = now() where id = ${report.job_id} and status = 'ACTIVE'`;
    if (report.business_id) await markLooked(report.business_id);
  }
  await db`
    update closure_reports
    set status = ${action === "confirm" ? "confirmed" : "dismissed"}, reviewed_at = now()
    where id = ${id}
  `;
  return { ok: true as const };
}

async function markLooked(businessId: string) {
  const db = getSql();
  const rows = await db<BusinessRow[]>`
    select id, name, area, address, source, hiring_checked_at, latitude, longitude
    from businesses
    where id = ${businessId}
    limit 1
  `;
  const business = rows[0];
  if (!business) return;
  await db`update businesses set hiring_checked_at = now(), updated_at = now() where id = ${business.id}`;
  const nearby = await db<BusinessRow[]>`
    select id, name, area, address, source, hiring_checked_at, latitude, longitude
    from businesses
    where source in ('osm', 'mock')
      and latitude between ${business.latitude - 0.03} and ${business.latitude + 0.03}
      and longitude between ${business.longitude - 0.05} and ${business.longitude + 0.05}
  `;
  for (const place of nearby) {
    if (!samePlaceName(place.name, business.name)) continue;
    if (distanceKm(place.latitude, place.longitude, business.latitude, business.longitude) > DOOR_MATCH_KM) continue;
    await db`update businesses set hiring_checked_at = now(), updated_at = now() where id = ${place.id}`;
  }
}

function toClosure(row: {
  id: string;
  job_id: string;
  place_name: string;
  job_title: string;
  status: ClosureReport["status"];
  created_at: Date | string;
}): ClosureReport {
  return {
    id: row.id,
    jobId: row.job_id,
    placeName: row.place_name,
    jobTitle: row.job_title,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
