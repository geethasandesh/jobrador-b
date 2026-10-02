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
  phone: string | null;
  website: string | null;
  opening_hours: string | null;
  source: string;
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
  status: CommunityLead["status"];
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
    phone: row.phone ?? undefined,
    website: row.website ?? undefined,
    openingHours: row.opening_hours ?? undefined,
    source: row.source,
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
    status: row.status,
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
    select id, name, category, address, city, area, latitude, longitude, phone, website, opening_hours, source
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
           latitude, longitude, created_at, confirm_yes, confirm_no, confirm_unsure, status,
           language_requirements, salary_min, salary_period, hours_min, hours_max
    from community_leads
    where status = 'ACTIVE'
      and ST_DWithin(location, ST_SetSRID(ST_MakePoint(${area.longitude}, ${area.latitude}), 4326)::geography, ${area.meters})
  `;
  return rows.map(mapLead);
}

export async function findBusiness(id: string) {
  const rows = await getSql()<BusinessRow[]>`
    select id, name, category, address, city, area, latitude, longitude, phone, website, opening_hours, source
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
           latitude, longitude, created_at, confirm_yes, confirm_no, confirm_unsure, status,
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

export async function leadsForBusiness(businessId: string) {
  const rows = await getSql()<LeadRow[]>`
    select id, business_id, business_name, title, description, job_type, category, address, city, area,
           latitude, longitude, created_at, confirm_yes, confirm_no, confirm_unsure, status,
           language_requirements, salary_min, salary_period, hours_min, hours_max
    from community_leads
    where business_id = ${businessId}
  `;
  return rows.map(mapLead);
}

export async function insertLead(lead: CommunityLead) {
  await getSql()`
    insert into community_leads (
      id, business_id, business_name, title, description, job_type, category, address, city, area,
      latitude, longitude, location, status, confirm_yes, confirm_no, confirm_unsure,
      salary_min, salary_period, hours_min, hours_max, language_requirements, created_at
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
      ${lead.salaryMin ?? null},
      ${lead.salaryPeriod ?? null},
      ${lead.hoursMin ?? null},
      ${lead.hoursMax ?? null},
      ${lead.language ? getSql().json(lead.language) : null},
      ${lead.reportedAt}
    )
  `;
}

export async function addConfirmation(id: string, vote: Vote) {
  const rows = await getSql()<LeadRow[]>`
    update community_leads
    set confirm_yes = confirm_yes + ${vote === "yes" ? 1 : 0},
        confirm_no = confirm_no + ${vote === "no" ? 1 : 0},
        confirm_unsure = confirm_unsure + ${vote === "unsure" ? 1 : 0},
        updated_at = now()
    where id = ${id} and status = 'ACTIVE'
    returning id, business_id, business_name, title, description, job_type, category, address, city, area,
              latitude, longitude, created_at, confirm_yes, confirm_no, confirm_unsure, status,
              language_requirements, salary_min, salary_period, hours_min, hours_max
  `;
  const row = rows[0];
  return row ? mapLead(row) : null;
}

export async function businessCount() {
  const rows = await getSql()<{ count: string }[]>`select count(*)::text as count from businesses`;
  return Number(rows[0]?.count ?? 0);
}
