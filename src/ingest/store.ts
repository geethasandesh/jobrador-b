import { getSql } from "../db/client.js";
import { distanceKm } from "../lib/geo.js";
import { notifyFreshJobs, type FreshJob } from "../modules/hiring-mail.js";
import { stableId, type NormalizedJob, type NormalizedPlace } from "./model.js";

export async function saveJobs(jobs: NormalizedJob[]) {
  if (jobs.length === 0) return 0;
  const sql = getSql();
  const externalIds = jobs.map((job) => job.externalId).filter((id): id is string => Boolean(id));
  const existing = externalIds.length
    ? await sql<{ source_name: string; external_id: string; status: string }[]>`
        select source_name, external_id, status from jobs where external_id in ${sql(externalIds)}
      `
    : [];
  const alreadyActive = new Set(
    existing.filter((row) => row.status === "ACTIVE").map((row) => `${row.source_name}|${row.external_id}`),
  );
  const fresh: FreshJob[] = jobs
    .filter((job) => !alreadyActive.has(`${job.sourceName}|${job.externalId}`))
    .map((job) => ({
      jobId: stableId("job", `${job.sourceName}|${job.externalId}`),
      businessId:
        job.businessId ??
        stableId("biz", `${job.sourceName}|${job.company.toLowerCase()}|${job.latitude.toFixed(4)}|${job.longitude.toFixed(4)}`),
      title: job.title,
      company: job.company,
      latitude: job.latitude,
      longitude: job.longitude,
    }));
  await sql.begin(async (tx) => {
    for (const job of jobs) {
      const businessId =
        job.businessId ??
        stableId(
          "biz",
          `${job.sourceName}|${job.company.toLowerCase()}|${job.latitude.toFixed(4)}|${job.longitude.toFixed(4)}`,
        );
      if (!job.businessId) {
        await tx`
          insert into businesses (
            id, name, category, address, city, area, latitude, longitude, location, website, source
          ) values (
            ${businessId},
            ${job.company},
            ${job.category},
            ${job.address},
            ${job.city},
            ${job.area},
            ${job.latitude},
            ${job.longitude},
            ${tx`ST_SetSRID(ST_MakePoint(${job.longitude}, ${job.latitude}), 4326)::geography`},
            ${job.website ?? null},
            ${job.sourceName}
          )
          on conflict (id) do update set
            name = excluded.name,
            category = excluded.category,
            address = excluded.address,
            city = excluded.city,
            area = excluded.area,
            latitude = excluded.latitude,
            longitude = excluded.longitude,
            location = excluded.location,
            website = coalesce(excluded.website, businesses.website),
            updated_at = now()
        `;
      }
      await tx`
        insert into jobs (
          id, business_id, title, job_type, category, description_summary,
          salary_min, salary_max, salary_period, hours_min, hours_max, language_requirements,
          latitude, longitude, location, source_name, source_url, external_id, posted_at, status
        ) values (
          ${stableId("job", `${job.sourceName}|${job.externalId}`)},
          ${businessId},
          ${job.title},
          ${job.jobType},
          ${job.category},
          ${job.summary},
          ${job.salaryMin ?? null},
          ${job.salaryMax ?? null},
          ${job.salaryPeriod ?? null},
          ${job.hoursMin ?? null},
          ${job.hoursMax ?? null},
          ${job.language ? tx.json(job.language) : null},
          ${job.latitude},
          ${job.longitude},
          ${tx`ST_SetSRID(ST_MakePoint(${job.longitude}, ${job.latitude}), 4326)::geography`},
          ${job.sourceName},
          ${job.sourceUrl},
          ${job.externalId},
          ${job.postedAt},
          'ACTIVE'
        )
        on conflict (source_name, external_id) where external_id is not null do update set
          business_id = excluded.business_id,
          title = excluded.title,
          job_type = excluded.job_type,
          category = excluded.category,
          description_summary = excluded.description_summary,
          salary_min = excluded.salary_min,
          salary_max = excluded.salary_max,
          salary_period = excluded.salary_period,
          hours_min = excluded.hours_min,
          hours_max = excluded.hours_max,
          language_requirements = excluded.language_requirements,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          location = excluded.location,
          source_url = excluded.source_url,
          posted_at = coalesce(jobs.posted_at, excluded.posted_at),
          status = 'ACTIVE',
          updated_at = now()
      `;
    }
  });
  await notifyFreshJobs(fresh).catch(() => undefined);
  return jobs.length;
}

export async function savePlaces(places: NormalizedPlace[], source = "osm") {
  if (places.length === 0) return 0;
  const sql = getSql();
  await sql.begin(async (tx) => {
    for (const place of places) {
      await tx`
        insert into businesses (
          id, name, category, address, city, area, postal_code, latitude, longitude, location,
          phone, website, source, source_id
        ) values (
          ${stableId("place", place.externalId)},
          ${place.name},
          ${place.category},
          ${place.address},
          ${place.city},
          ${place.area},
          ${place.postalCode ?? null},
          ${place.latitude},
          ${place.longitude},
          ${tx`ST_SetSRID(ST_MakePoint(${place.longitude}, ${place.latitude}), 4326)::geography`},
          ${place.phone ?? null},
          ${place.website ?? null},
          ${source},
          ${place.sourceId}
        )
        on conflict (id) do update set
          name = excluded.name,
          category = excluded.category,
          address = excluded.address,
          city = excluded.city,
          area = excluded.area,
          postal_code = coalesce(excluded.postal_code, businesses.postal_code),
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          location = excluded.location,
          phone = coalesce(excluded.phone, businesses.phone),
          website = coalesce(excluded.website, businesses.website),
          source = excluded.source,
          source_id = excluded.source_id,
          updated_at = now()
      `;
    }
  });
  return places.length;
}

export async function expireMissing(sourceName: string, externalIds: string[]) {
  if (externalIds.length === 0) return 0;
  const sql = getSql();
  const rows = await sql<{ id: string }[]>`
    update jobs
    set status = 'EXPIRED', updated_at = now()
    where source_name = ${sourceName}
      and status = 'ACTIVE'
      and external_id is not null
      and not (external_id in ${sql(externalIds)})
    returning id
  `;
  return rows.length;
}

export async function retireSample() {
  const sql = getSql();
  await sql`
    delete from saved_jobs
    where job_id in (
      select id from jobs
      where source_name not in ('arbeitsagentur', 'kleinanzeigen', 'career_page', 'jobsnjoy')
    )
  `;
  const jobs = await sql<{ id: string }[]>`
    delete from jobs
    where source_name not in ('arbeitsagentur', 'kleinanzeigen', 'career_page', 'jobsnjoy')
    returning id
  `;
  const businesses = await sql<{ id: string }[]>`
    delete from businesses b
    where b.source not in ('arbeitsagentur', 'kleinanzeigen', 'career_page', 'osm')
      and not exists (select 1 from jobs j where j.business_id = b.id)
      and not exists (select 1 from community_leads l where l.business_id = b.id)
    returning b.id
  `;
  await sql`
    delete from businesses b
    where b.source in ('arbeitsagentur', 'kleinanzeigen', 'jobsnjoy')
      and not exists (select 1 from jobs j where j.business_id = b.id)
      and not exists (select 1 from community_leads l where l.business_id = b.id)
  `;
  await sql`
    update community_leads
    set status = 'EXPIRED', updated_at = now()
    where status = 'ACTIVE'
      and id !~ '^lead_[0-9a-z]*[0-9][0-9a-z]*$'
  `;
  return { jobs: jobs.length, businesses: businesses.length };
}

export async function attachBusinessesToJobLocations() {
  const sql = getSql();
  const rows = await sql<
    {
      id: string;
      business_id: string;
      category: string;
      latitude: number | string;
      longitude: number | string;
      source_name: string;
      name: string;
      address: string;
      city: string;
      area: string | null;
      website: string | null;
      phone: string | null;
      blat: number | string;
      blng: number | string;
    }[]
  >`
    select j.id, j.business_id, j.category, j.latitude, j.longitude, j.source_name,
           b.name, b.address, b.city, b.area, b.website, b.phone,
           b.latitude as blat, b.longitude as blng
    from jobs j
    join businesses b on b.id = j.business_id
    where j.status = 'ACTIVE'
      and j.source_name in ('arbeitsagentur', 'kleinanzeigen')
  `;

  let moved = 0;
  for (const row of rows) {
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    const away = distanceKm(latitude, longitude, Number(row.blat), Number(row.blng));
    if (away < 0.2) continue;
    const businessId = stableId(
      "biz",
      `${row.source_name}|${row.name.toLowerCase()}|${latitude.toFixed(4)}|${longitude.toFixed(4)}`,
    );
    await sql`
      insert into businesses (
        id, name, category, address, city, area, latitude, longitude, location, phone, website, source
      ) values (
        ${businessId},
        ${row.name},
        ${row.category},
        ${row.address},
        ${row.city},
        ${row.area},
        ${latitude},
        ${longitude},
        ${sql`ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography`},
        ${row.phone},
        ${row.website},
        ${row.source_name}
      )
      on conflict (id) do update set
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        location = excluded.location,
        updated_at = now()
    `;
    await sql`update jobs set business_id = ${businessId}, updated_at = now() where id = ${row.id}`;
    moved += 1;
  }
  return moved;
}
