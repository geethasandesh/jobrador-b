import type { Business, CommunityLead, Job, LeadJobType, Vote } from "../types.js";
import { getSql } from "./client.js";

type BusinessRow = {
  id: string;
  name: string;
  category: Business["category"];
  address: string;
  city: string;
  area: string | null;
  latitude: number | string;
  longitude: number | string;
  postal_code: string | null;
  phone: string | null;
  website: string | null;
  opening_hours: string | null;
  source: string;
  source_id: string | null;
  hiring_checked_at: Date | string | null;
};

type JobRow = {
  id: string;
  business_id: string;
  title: string;
  job_type: Job["jobType"];
  category: Job["category"];
  description_summary: string;
  salary_min: number | string | null;
  salary_max: number | string | null;
  salary_period: "hour" | "month" | null;
  hours_min: number | string | null;
  hours_max: number | string | null;
  language_requirements: Job["language"] | null;
  latitude: number | string;
  longitude: number | string;
  source_name: string;
  source_url: string;
  posted_at: Date | string | null;
  status: Job["status"];
};

type LeadRow = {
  id: string;
  business_id: string | null;
  business_name: string;
  title: string;
  description: string;
  job_type: LeadJobType;
  category: CommunityLead["category"];
  address: string;
  city: string;
  area: string | null;
  latitude: number | string;
  longitude: number | string;
  created_at: Date | string;
  confirm_yes: number;
  confirm_no: number;
  confirm_unsure: number;
  confirm_done: number;
  status: CommunityLead["status"];
  poster: string | null;
  language_requirements: CommunityLead["language"] | null;
  salary_min: number | string | null;
  salary_period: "hour" | "month" | null;
  hours_min: number | string | null;
  hours_max: number | string | null;
};

function num(value: number | string | null | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function requiredNum(value: number | string): number {
  return Number(value);
}

function iso(value: Date | string | null | undefined): string | undefined {
  if (value == null) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function point(latitude: number, longitude: number) {
  const sql = getSql();
  return sql`ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography`;
}

function mapBusiness(row: BusinessRow): Business {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    address: row.address,
    city: row.city,
    area: row.area ?? "",
    latitude: requiredNum(row.latitude),
    longitude: requiredNum(row.longitude),
    postalCode: row.postal_code ?? undefined,
    phone: row.phone ?? undefined,
    website: row.website ?? undefined,
    openingHours: row.opening_hours ?? undefined,
    source: row.source,
    sourceId: row.source_id ?? undefined,
    hiringCheckedAt: iso(row.hiring_checked_at),
  };
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    businessId: row.business_id,
    title: row.title,
    jobType: row.job_type,
    category: row.category,
    descriptionSummary: row.description_summary,
    salaryMin: num(row.salary_min),
    salaryMax: num(row.salary_max),
    salaryPeriod: row.salary_period ?? undefined,
    hoursMin: num(row.hours_min),
    hoursMax: num(row.hours_max),
    language: row.language_requirements ?? undefined,
    latitude: requiredNum(row.latitude),
    longitude: requiredNum(row.longitude),
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    postedAt: iso(row.posted_at) ?? new Date(0).toISOString(),
    status: row.status,
  };
}

function mapLead(row: LeadRow): CommunityLead {
  return {
    id: row.id,
    businessId: row.business_id ?? undefined,
    businessName: row.business_name,
    title: row.title,
    description: row.description,
    jobType: row.job_type,
    category: row.category,
    address: row.address,
    city: row.city,
    area: row.area ?? "",
    latitude: requiredNum(row.latitude),
    longitude: requiredNum(row.longitude),
    reportedAt: iso(row.created_at) ?? new Date().toISOString(),
    confirmYes: row.confirm_yes,
    confirmNo: row.confirm_no,
    confirmUnsure: row.confirm_unsure,
    confirmDone: row.confirm_done ?? 0,
    status: row.status,
    poster: row.poster === "business" ? "business" : "student",
    language: row.language_requirements ?? undefined,
    salaryMin: num(row.salary_min),
    salaryPeriod: row.salary_period ?? undefined,
    hoursMin: num(row.hours_min),
    hoursMax: num(row.hours_max),
  };
}

function origin(latitude: number, longitude: number, radiusKm: number) {
  const meters = radiusKm * 1000 + 200;
  return { latitude, longitude, meters };
}

export async function businessesInRadius(latitude: number, longitude: number, radiusKm: number) {
  const area = origin(latitude, longitude, radiusKm);
  const rows = await getSql()<BusinessRow[]>`
    select id, name, category, address, city, area, postal_code, latitude, longitude, phone, website, opening_hours, source, source_id, hiring_checked_at
    from businesses
    where ST_DWithin(location, ST_SetSRID(ST_MakePoint(${area.longitude}, ${area.latitude}), 4326)::geography, ${area.meters})
  `;
  return rows.map(mapBusiness);
}

export async function jobsInRadius(latitude: number, longitude: number, radiusKm: number) {
  const area = origin(latitude, longitude, radiusKm);
  const rows = await getSql()<JobRow[]>`
    select id, business_id, title, job_type, category, description_summary,
           salary_min, salary_max, salary_period, hours_min, hours_max, language_requirements,
           latitude, longitude, source_name, source_url, posted_at, status
    from jobs
    where status = 'ACTIVE'
      and ST_DWithin(location, ST_SetSRID(ST_MakePoint(${area.longitude}, ${area.latitude}), 4326)::geography, ${area.meters})
  `;
  return rows.map(mapJob);
}

export async function leadsInRadius(latitude: number, longitude: number, radiusKm: number) {
  const area = origin(latitude, longitude, radiusKm);
  const rows = await getSql()<LeadRow[]>`
    select id, business_id, business_name, title, description, job_type, category, address, city, area,
           latitude, longitude, created_at, confirm_yes, confirm_no, confirm_unsure, confirm_done, status, poster,
           language_requirements, salary_min, salary_period, hours_min, hours_max
    from community_leads
    where status = 'ACTIVE'
      and ST_DWithin(location, ST_SetSRID(ST_MakePoint(${area.longitude}, ${area.latitude}), 4326)::geography, ${area.meters})
  `;
  return rows.map(mapLead);
}

export async function findBusiness(id: string) {
  const rows = await getSql()<BusinessRow[]>`
    select id, name, category, address, city, area, postal_code, latitude, longitude, phone, website, opening_hours, source, source_id, hiring_checked_at
    from businesses
    where id = ${id}
  `;
  const row = rows[0];
  return row ? mapBusiness(row) : null;
}

export async function findJob(id: string) {
  const rows = await getSql()<JobRow[]>`
    select id, business_id, title, job_type, category, description_summary,
           salary_min, salary_max, salary_period, hours_min, hours_max, language_requirements,
           latitude, longitude, source_name, source_url, posted_at, status
    from jobs
    where id = ${id}
  `;
  const row = rows[0];
  return row ? mapJob(row) : null;
}

export async function findLead(id: string) {
  const rows = await getSql()<LeadRow[]>`
    select id, business_id, business_name, title, description, job_type, category, address, city, area,
           latitude, longitude, created_at, confirm_yes, confirm_no, confirm_unsure, confirm_done, status, poster,
           language_requirements, salary_min, salary_period, hours_min, hours_max
    from community_leads
    where id = ${id}
  `;
  const row = rows[0];
  return row ? mapLead(row) : null;
}

export async function jobsForBusiness(businessId: string) {
  const rows = await getSql()<JobRow[]>`
    select id, business_id, title, job_type, category, description_summary,
           salary_min, salary_max, salary_period, hours_min, hours_max, language_requirements,
           latitude, longitude, source_name, source_url, posted_at, status
    from jobs
    where business_id = ${businessId}
  `;
  return rows.map(mapJob);
}

export async function jobsNear(latitude: number, longitude: number, radiusKm = 0.25) {
  const rows = await getSql()<Array<JobRow & { business_name: string }>>`
    select j.id, j.business_id, j.title, j.job_type, j.category, j.description_summary,
           j.salary_min, j.salary_max, j.salary_period, j.hours_min, j.hours_max, j.language_requirements,
           j.latitude, j.longitude, j.source_name, j.source_url, j.posted_at, j.status,
           b.name as business_name
    from jobs j
    join businesses b on b.id = j.business_id
    where j.status = 'ACTIVE'
      and ST_DWithin(
        j.location,
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
        ${Math.round(radiusKm * 1000)}
      )
    order by ST_Distance(
      j.location,
      ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
    )
    limit 80
  `;
  return rows.map((row) => ({ job: mapJob(row), businessName: row.business_name }));
}

export async function leadsForBusiness(businessId: string) {
  const rows = await getSql()<LeadRow[]>`
    select id, business_id, business_name, title, description, job_type, category, address, city, area,
           latitude, longitude, created_at, confirm_yes, confirm_no, confirm_unsure, confirm_done, status, poster,
           language_requirements, salary_min, salary_period, hours_min, hours_max
    from community_leads
    where business_id = ${businessId}
  `;
  return rows.map(mapLead);
}

export async function insertLead(lead: CommunityLead, accountId: string) {
  await getSql()`
    insert into community_leads (
      id, business_id, business_name, title, description, job_type, category, address, city, area,
      latitude, longitude, location, status, confirm_yes, confirm_no, confirm_unsure, confirm_done,
      salary_min, salary_period, hours_min, hours_max, language_requirements, created_at, account_id, poster
    ) values (
      ${lead.id},
      ${lead.businessId ?? null},
      ${lead.businessName},
      ${lead.title},
      ${lead.description},
      ${lead.jobType},
      ${lead.category},
      ${lead.address},
      ${lead.city},
      ${lead.area},
      ${lead.latitude},
      ${lead.longitude},
      ${point(lead.latitude, lead.longitude)},
      ${lead.status},
      ${lead.confirmYes},
      ${lead.confirmNo},
      ${lead.confirmUnsure},
      ${lead.confirmDone},
      ${lead.salaryMin ?? null},
      ${lead.salaryPeriod ?? null},
      ${lead.hoursMin ?? null},
      ${lead.hoursMax ?? null},
      ${lead.language ? getSql().json(lead.language) : null},
      ${lead.reportedAt},
      ${accountId},
      ${lead.poster}
    )
  `;
}

export async function countRecentLeads(accountId: string): Promise<number> {
  const rows = await getSql()<{ count: number }[]>`
    select count(*)::int as count
    from community_leads
    where account_id = ${accountId}
      and created_at > now() - interval '1 day'
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function addConfirmation(id: string, vote: Vote, accountId: string) {
  const db = getSql();
  const existing = await db<{ account_id: string | null; status: string; poster: string | null }[]>`
    select account_id, status, poster from community_leads where id = ${id} limit 1
  `;
  const current = existing[0];
  if (!current || current.status === "REMOVED") return null;

  const prior = await db<{ status: string }[]>`
    select status from lead_confirmations
    where lead_id = ${id} and account_id = ${accountId}
    limit 1
  `;
  const previous = prior[0]?.status ?? null;
  const wasFilled = current.status === "FILLED";
  if (previous === vote) {
    return { changed: false, wasFilled };
  }

  await db`
    insert into lead_confirmations (lead_id, account_id, status)
    values (${id}, ${accountId}, ${vote})
    on conflict (lead_id, account_id) where account_id is not null
    do update set status = excluded.status
  `;

  const counts = await db<{ status: string; count: number }[]>`
    select status, count(*)::int as count
    from lead_confirmations
    where lead_id = ${id}
    group by status
  `;
  const tally = { yes: 0, no: 0, unsure: 0, done: 0 };
  for (const row of counts) {
    if (row.status === "yes" || row.status === "no" || row.status === "unsure" || row.status === "done") {
      tally[row.status] = Number(row.count);
    }
  }

  let ownerSaidDone = false;
  if (current.account_id) {
    const ownerVote = await db<{ status: string }[]>`
      select status from lead_confirmations
      where lead_id = ${id} and account_id = ${current.account_id}
      limit 1
    `;
    ownerSaidDone = ownerVote[0]?.status === "done";
  }
  const filled = current.poster === "business" ? ownerSaidDone : ownerSaidDone || tally.done >= 2;
  const status = filled ? "FILLED" : wasFilled ? "ACTIVE" : current.status;

  await db`
    update community_leads
    set confirm_yes = ${tally.yes},
        confirm_no = ${tally.no},
        confirm_unsure = ${tally.unsure},
        confirm_done = ${tally.done},
        status = ${status},
        updated_at = now()
    where id = ${id}
  `;
  return { changed: true, wasFilled };
}

export async function leadsForAccount(accountId: string) {
  const rows = await getSql()<LeadRow[]>`
    select id, business_id, business_name, title, description, job_type, category, address, city, area,
           latitude, longitude, created_at, confirm_yes, confirm_no, confirm_unsure, confirm_done, status, poster,
           language_requirements, salary_min, salary_period, hours_min, hours_max
    from community_leads
    where account_id = ${accountId}
      and poster = 'business'
      and status in ('ACTIVE', 'FILLED')
    order by created_at desc
  `;
  return rows.map(mapLead);
}

export async function ownedLead(id: string) {
  const rows = await getSql()<{ account_id: string | null; status: string }[]>`
    select account_id, status from community_leads where id = ${id} limit 1
  `;
  return rows[0] ?? null;
}

export async function updateOwnedLead(id: string, accountId: string, status: "ACTIVE" | "FILLED" | "REMOVED") {
  const rows = await getSql()<{ id: string }[]>`
    update community_leads
    set status = ${status}, updated_at = now()
    where id = ${id} and account_id = ${accountId}
    returning id
  `;
  return rows.length > 0;
}

export async function hasLiveJobs() {
  const rows = await getSql()<{ ok: number }[]>`
    select 1 as ok from jobs
    where status = 'ACTIVE'
      and source_name in ('arbeitsagentur', 'kleinanzeigen', 'career_page', 'jobsnjoy')
    limit 1
  `;
  return rows.length > 0;
}

export async function businessCount() {
  const rows = await getSql()<{ count: string }[]>`select count(*)::text as count from businesses`;
  return Number(rows[0]?.count ?? 0);
}
