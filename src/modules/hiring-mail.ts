import { getSql } from "../db/client.js";
import { sendHiringNotice, siteOrigin } from "../email/mail.js";
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
}

function placeMatches(place: PlaceSave, job: FreshJob) {
  if (place.item_id === job.businessId) return true;
  if (!samePlaceName(place.name, job.company)) return false;
  return distanceKm(place.latitude, place.longitude, job.latitude, job.longitude) <= DOOR_MATCH_KM;
}
