import { getSql } from "../db/client.js";
import type { Category } from "../types.js";
import { clip, type NormalizedJob } from "./model.js";
import { categoryFrom, hoursFrom, jobTypeFrom, languageFrom, moneyFrom, summaryFrom } from "./normalize.js";

type PlaceRow = {
  id: string;
  name: string;
  category: Category;
  address: string;
  city: string;
  area: string | null;
  latitude: number;
  longitude: number;
  website: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decode(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

export type CareerPlace = PlaceRow;

export type CareerCheck = { status: "hiring"; job: NormalizedJob } | { status: "none" } | { status: "retry" } | { status: "no_site" };

export function readableWebsite(website: string | null | undefined) {
  if (!website) return null;
  let url: URL;
  try {
    url = new URL(website);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (/facebook\.|instagram\.|linktr\.ee|google\.|maps\.app/i.test(url.hostname)) return null;
  return url;
}

export async function checkCareerSite(place: CareerPlace): Promise<CareerCheck> {
  const website = readableWebsite(place.website);
  if (!website) return { status: "no_site" };
  const home = await readPage(website.toString()).catch(() => null);
  let text = home ? hiringPage(home, place.name, website.toString()) : null;
  let sourceUrl = website.toString();
  let fetched = Boolean(home);
  if (!text) {
    const link = home?.match(/href="([^"]*(?:karriere|stellenangebot|jobs-karriere|\/jobs|\/stellen)[^"]*)"/i)?.[1];
    const paths = ["/jobs", "/jobs/", "/karriere", "/jobs-karriere/", "/stellen"];
    const targets: URL[] = [];
    if (link) {
      try {
        targets.push(new URL(link, website));
      } catch {
        targets.push(website);
      }
    }
    for (const path of paths) targets.push(new URL(path, website));
    const seen = new Set<string>([website.toString()]);
    for (const next of targets) {
      if (seen.has(next.toString()) || next.hostname !== website.hostname) continue;
      seen.add(next.toString());
      if (seen.size > 4) break;
      const page = await readPage(next.toString()).catch(() => null);
      if (!page) continue;
      fetched = true;
      text = hiringPage(page, place.name, next.toString());
      if (text) {
        sourceUrl = next.toString();
        break;
      }
    }
  }
  if (!text) return fetched ? { status: "none" } : { status: "retry" };
  return {
    status: "hiring",
    job: {
      sourceName: "career_page",
      externalId: place.id,
      businessId: place.id,
      title: roleTitle(text),
      company: place.name,
      category: place.category || categoryFrom(text),
      jobType: jobTypeFrom(text),
      summary: summaryFrom(text),
      address: place.address,
      city: place.city,
      area: place.area ?? "Berlin",
      latitude: Number(place.latitude),
      longitude: Number(place.longitude),
      sourceUrl,
      postedAt: new Date().toISOString(),
      website: place.website,
      ...hoursFrom(text),
      ...moneyFrom(text),
      language: languageFrom(text),
    },
  };
}

function visibleText(html: string) {
  return decode(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
}

function roleTitle(text: string) {
  const role = text.match(
    /\b(?:Minijob|Aushilfe|Servicekraft|Werkstudent|Barista|Kellner|Reinigungskraft|Housekeeping)(?:in)?\b[^.\n]{0,40}/,
  )?.[0];
  return role ? clip(role, 80) : "Open role";
}

function hiringPage(html: string, name: string, pageUrl: string) {
  const text = visibleText(html);
  if (/function\s*\(|typekit\.load|addeventlistener|font-face/i.test(text)) return null;
  const onCareerPage = /\/(jobs|karriere|stellen)/i.test(pageUrl);
  const hiring = onCareerPage
    ? /wir suchen|stellenangebot|minijob|aushilfe|werkstudent|jetzt bewerben|stellenanzeige/i.test(text)
    : /wir suchen|stellenangebot|minijob|aushilfe gesucht|werkstudent|jetzt bewerben/i.test(text);
  const local = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 40), "i").test(text) || /berlin/i.test(text);
  return hiring && local ? text : null;
}

async function readPage(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "text/html", "User-Agent": "jobrador/0.1 (berlin student job map)" },
    signal: AbortSignal.timeout(8_000),
    redirect: "follow",
  });
  if (!response.ok) return null;
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("html")) return null;
  return (await response.text()).slice(0, 180_000);
}

export async function fetchCareerPages(): Promise<NormalizedJob[]> {
  const rows = await getSql()<PlaceRow[]>`
    select id, name, category, address, city, area, latitude, longitude, website
    from businesses
    where source = 'osm' and website is not null and website <> ''
    order by updated_at asc
    limit 25
  `;

  const jobs: NormalizedJob[] = [];
  for (const place of rows) {
    await sleep(400);
    const checked = await checkCareerSite(place);
    if (checked.status === "hiring") jobs.push(checked.job);
    if (checked.status === "hiring" || checked.status === "none" || checked.status === "no_site") {
      await getSql()`update businesses set hiring_checked_at = now(), updated_at = now() where id = ${place.id}`;
    }
  }
  return jobs;
}
