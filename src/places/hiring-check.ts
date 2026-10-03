import { getSql } from "../db/client.js";
import { checkCareerSite, type CareerPlace } from "../ingest/career-pages.js";
import { saveJobs } from "../ingest/store.js";
import type { Category } from "../types.js";

const BATCH = 40;
const circles = new Set<string>();

type Row = {
  id: string;
  name: string;
  category: Category;
  address: string;
  city: string;
  area: string | null;
  latitude: number | string;
  longitude: number | string;
  website: string | null;
};

export function startHiringChecks(latitude: number, longitude: number, radiusKm: number) {
  const key = `${latitude.toFixed(2)}:${longitude.toFixed(2)}:${Math.round(radiusKm)}`;
  if (circles.has(key)) return;
  circles.add(key);
  void checkCircle(latitude, longitude, radiusKm).finally(() => circles.delete(key));
}

async function checkCircle(latitude: number, longitude: number, radiusKm: number) {
  const meters = Math.min(radiusKm, 10) * 1000 + 200;
  const redo = await dropCodePostings(longitude, latitude, meters);
  const rows = await getSql()<Row[]>`
    select id, name, category, address, city, area, latitude, longitude, website
    from businesses
    where source in ('osm', 'mock')
      and (hiring_checked_at is null or hiring_checked_at < now() - interval '7 days')
      and ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
        ${meters}
      )
    order by (website is null), updated_at desc nulls last
    limit ${BATCH}
  `;
  const priority = redo.length
    ? await getSql()<Row[]>`
        select id, name, category, address, city, area, latitude, longitude, website
        from businesses
        where id in ${getSql()(redo)}
      `
    : [];
  const queue = [...priority, ...rows.filter((row) => !priority.some((item) => item.id === row.id))];

  for (const row of queue) {
    await wait(450);
    const place: CareerPlace = {
      id: row.id,
      name: row.name,
      category: row.category,
      address: row.address,
      city: row.city,
      area: row.area,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      website: row.website ?? "",
    };
    const checked = await checkCareerSite(place);
    if (checked.status === "retry") continue;
    if (checked.status === "hiring") await saveJobs([checked.job]);
    else await clearCareerPost(row.id);
    await getSql()`update businesses set hiring_checked_at = now(), updated_at = now() where id = ${row.id}`;
  }
}

async function dropCodePostings(longitude: number, latitude: number, meters: number) {
  const rows = await getSql()<{ business_id: string }[]>`
    update jobs
    set status = 'EXPIRED', updated_at = now()
    where source_name = 'career_page'
      and status = 'ACTIVE'
      and (
        description_summary ilike '%function(%'
        or description_summary ilike '%typekit%'
        or description_summary ilike '%addeventlistener%'
        or description_summary ilike '%font-face%'
        or title like '%\\u00%'
        or title ilike '%gnzburg%'
        or description_summary like '%\\u00%'
      )
      and business_id in (
        select id from businesses
        where source in ('osm', 'mock')
          and ST_DWithin(
            location,
            ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
            ${meters}
          )
      )
    returning business_id
  `;
  const ids = [...new Set(rows.map((row) => row.business_id))];
  if (ids.length === 0) return [];
  const sql = getSql();
  await sql`
    update businesses
    set hiring_checked_at = null, updated_at = now()
    where id in ${sql(ids)}
  `;
  return ids;
}

async function clearCareerPost(businessId: string) {
  await getSql()`
    update jobs
    set status = 'EXPIRED', updated_at = now()
    where source_name = 'career_page'
      and external_id = ${businessId}
      and status = 'ACTIVE'
  `;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
