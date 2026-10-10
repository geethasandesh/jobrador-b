import { getSql } from "../db/client.js";
import { sendAreaAlert, sendHiringNotice, siteOrigin } from "../email/mail.js";
import { distanceKm } from "../lib/geo.js";
import { samePlaceName } from "../lib/place-name.js";

const DOOR_MATCH_KM = 2;

export type FreshJob = {
  jobId: string;
  businessId: string;
  title: string;
  company: string;
  latitude: number;
  longitude: number;
};

type PlaceSave = {
  account_id: string;
  item_id: string;
  name: string;
  latitude: number;
  longitude: number;
};

function isJobSeeker(title: string) {
  return /^(?:suche|sucht)\b/i.test(title) || /\bsucht\s+(?:einen\s+|eine\s+|ein\s+)?mini-?job/i.test(title);
}

export async function notifyFreshJobs(input: FreshJob[]) {
  const jobs = input.filter((job) => !isJobSeeker(job.title));
  if (jobs.length === 0) return;
  const db = getSql();
  let saves: PlaceSave[] = [];
  try {
    saves = await db<PlaceSave[]>`
      select s.account_id, s.item_id, b.name, b.latitude, b.longitude
      from account_saves s
      join businesses b on b.id = s.item_id
      where s.kind = 'nearby_business'
    `;
  } catch {
    return;
  }
  if (saves.length === 0) return;

  const accountIds = [...new Set(saves.map((row) => row.account_id))];
  const people = await db<{ id: string; email: string | null }[]>`
    select id::text as id, email from auth.users where id::text in ${db(accountIds)}
  `.catch(() => [] as { id: string; email: string | null }[]);
  const emailByAccount = new Map(people.flatMap((row) => (row.email ? [[row.id, row.email] as const] : [])));

  const sent = await db<{ account_id: string; job_id: string }[]>`
    select account_id, job_id from hiring_notices where job_id in ${db(jobs.map((job) => job.jobId))}
  `.catch(() => [] as { account_id: string; job_id: string }[]);
  const already = new Set(sent.map((row) => `${row.account_id}|${row.job_id}`));

  const grouped = new Map<string, { accountId: string; email: string; placeName: string; titles: string[]; jobId: string; jobIds: string[] }>();
  for (const job of jobs) {
    for (const place of saves) {
      if (!placeMatches(place, job)) continue;
      if (already.has(`${place.account_id}|${job.jobId}`)) continue;
      const email = emailByAccount.get(place.account_id);
      if (!email) continue;
      const key = `${place.account_id}|${place.item_id}`;
      const current = grouped.get(key) ?? {
        accountId: place.account_id,
        email,
        placeName: place.name,
        titles: [],
        jobId: job.jobId,
        jobIds: [],
      };
      if (!current.jobIds.includes(job.jobId)) {
        current.titles.push(job.title);
        current.jobIds.push(job.jobId);
      }
      grouped.set(key, current);
    }
  }

  const origin = siteOrigin();
  for (const notice of grouped.values()) {
    const result = await sendHiringNotice(notice.email, {
      placeName: notice.placeName,
      titles: notice.titles,
      jobUrl: `${origin}/jobs/${notice.jobId}`,
    }).catch(() => ({ error: "send failed" }));
    if ("error" in result && result.error) continue;
    for (const jobId of notice.jobIds) {
      await db`
        insert into hiring_notices (account_id, job_id)
        values (${notice.accountId}, ${jobId})
        on conflict (account_id, job_id) do nothing
      `;
    }
  }
  await notifyAreaAlerts(jobs).catch(() => undefined);
}

type AreaAlert = {
  account_id: string;
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  radius_km: number;
};

async function notifyAreaAlerts(jobs: FreshJob[]) {
  const db = getSql();
  await ensureAreaAlerts();
  const areas = await db<AreaAlert[]>`
    select account_id, id, label, latitude, longitude, radius_km from area_alerts
  `.catch(() => [] as AreaAlert[]);
  if (areas.length === 0) return;

  const accountIds = [...new Set(areas.map((row) => row.account_id))];
  const people = await db<{ id: string; email: string | null }[]>`
    select id::text as id, email from auth.users where id::text in ${db(accountIds)}
  `.catch(() => [] as { id: string; email: string | null }[]);
  const emailByAccount = new Map(people.flatMap((row) => (row.email ? [[row.id, row.email] as const] : [])));

  const sent = await db<{ account_id: string; job_id: string }[]>`
    select account_id, job_id from hiring_notices where job_id in ${db(jobs.map((job) => job.jobId))}
  `.catch(() => [] as { account_id: string; job_id: string }[]);
  const already = new Set(sent.map((row) => `${row.account_id}|${row.job_id}`));

  const grouped = new Map<string, { accountId: string; email: string; label: string; titles: string[]; jobIds: string[]; latitude: number; longitude: number; radiusKm: number }>();
  for (const job of jobs) {
    for (const area of areas) {
      if (already.has(`${area.account_id}|${job.jobId}`)) continue;
      if (distanceKm(area.latitude, area.longitude, job.latitude, job.longitude) > Number(area.radius_km)) continue;
      const email = emailByAccount.get(area.account_id);
      if (!email) continue;
      const key = `${area.account_id}|${area.id}`;
      const current = grouped.get(key) ?? {
        accountId: area.account_id,
        email,
        label: area.label,
        titles: [],
        jobIds: [],
        latitude: area.latitude,
        longitude: area.longitude,
        radiusKm: Number(area.radius_km),
      };
      if (!current.jobIds.includes(job.jobId)) {
        current.titles.push(`${job.title} at ${job.company}`);
        current.jobIds.push(job.jobId);
      }
      grouped.set(key, current);
    }
  }

  const origin = siteOrigin();
  for (const notice of grouped.values()) {
    const params = new URLSearchParams({
      lat: String(notice.latitude),
      lng: String(notice.longitude),
      radiusKm: String(notice.radiusKm),
      label: notice.label,
    });
    const result = await sendAreaAlert(notice.email, {
      place: notice.label,
      titles: notice.titles,
      mapUrl: `${origin}/map?${params.toString()}`,
    }).catch(() => ({ error: "send failed" }));
    if ("error" in result && result.error) continue;
    for (const jobId of notice.jobIds) {
      await db`
        insert into hiring_notices (account_id, job_id)
        values (${notice.accountId}, ${jobId})
        on conflict (account_id, job_id) do nothing
      `;
    }
  }
}

export async function ensureAreaAlerts() {
  const db = getSql();
  await db`
    create table if not exists area_alerts (
      account_id text not null,
      id text not null,
      label text not null,
      latitude double precision not null,
      longitude double precision not null,
      radius_km double precision not null,
      created_at timestamptz not null default now(),
      primary key (account_id, id)
    )
  `;
  await db`alter table area_alerts enable row level security`.catch(() => undefined);
  await db`revoke all on table area_alerts from anon, authenticated`.catch(() => undefined);
}

export function areaWatchId(latitude: number, longitude: number, radiusKm: number) {
  return `${latitude.toFixed(3)}:${longitude.toFixed(3)}:${radiusKm}`;
}

export async function listAreaAlerts(accountId: string) {
  await ensureAreaAlerts();
  const rows = await getSql()<AreaAlert[]>`
    select account_id, id, label, latitude, longitude, radius_km
    from area_alerts
    where account_id = ${accountId}
    order by created_at desc
    limit 3
  `;
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    radiusKm: Number(row.radius_km),
  }));
}

export async function saveAreaAlert(
  accountId: string,
  input: { label: string; latitude: number; longitude: number; radiusKm: number },
) {
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) return { error: "Pick a place on the map." };
  if (!Number.isFinite(input.radiusKm) || input.radiusKm < 0.5 || input.radiusKm > 10) {
    return { error: "Choose a radius between 1 and 10 km." };
  }
  const label = input.label.trim().slice(0, 120);
  if (!label) return { error: "Name this area." };
  await ensureAreaAlerts();
  const db = getSql();
  const id = areaWatchId(input.latitude, input.longitude, input.radiusKm);
  const count = await db<{ total: number }[]>`
    select count(*)::int as total from area_alerts where account_id = ${accountId} and id <> ${id}
  `;
  if ((count[0]?.total ?? 0) >= 3) return { error: "You can watch three areas. Turn one off first." };
  await db`
    insert into area_alerts (account_id, id, label, latitude, longitude, radius_km)
    values (${accountId}, ${id}, ${label}, ${input.latitude}, ${input.longitude}, ${input.radiusKm})
    on conflict (account_id, id) do update set
      label = excluded.label,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      radius_km = excluded.radius_km
  `;
  return { id };
}

export async function removeAreaAlert(accountId: string, id: string) {
  await ensureAreaAlerts();
  await getSql()`delete from area_alerts where account_id = ${accountId} and id = ${id}`;
  return { ok: true as const };
}

function placeMatches(place: PlaceSave, job: FreshJob) {
  if (place.item_id === job.businessId) return true;
  if (!samePlaceName(place.name, job.company)) return false;
  return distanceKm(place.latitude, place.longitude, job.latitude, job.longitude) <= DOOR_MATCH_KM;
}
