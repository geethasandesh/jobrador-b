import { distanceKm } from "../lib/geo.js";
import { geocode } from "./geocode.js";
import { inBerlin, type NormalizedJob } from "./model.js";
import {
  categoryFrom,
  hoursFrom,
  jobTypeFrom,
  languageFrom,
  moneyFrom,
  summaryFrom,
} from "./normalize.js";

const lists = [
  "https://jobsnjoy.com/jobs/minijob/berlin",
  "https://jobsnjoy.com/jobs/teilzeit/berlin",
  "https://jobsnjoy.com/jobs/werkstudent/berlin",
];

const headers = {
  Accept: "text/html",
  "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
  "User-Agent": "jobrador/0.1 (berlin student job map)",
};

type Row = { id: string; title: string; company: string };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decode(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function rowsFrom(html: string): Row[] {
  const rows: Row[] = [];
  const chunks = html.split('class="hub-row"').slice(1);
  for (const chunk of chunks) {
    const href = chunk.match(/href="\/job-boards\/([a-f0-9]+)"/i)?.[1];
    const title = decode(chunk.match(/hub-row__title">([^<]+)/)?.[1] ?? "");
    const meta = decode(chunk.match(/hub-row__meta">([^<]+)/)?.[1] ?? "");
    const company = meta.split(/[·|]/)[0]?.trim() ?? "";
    if (!href || !title || company.length < 2) continue;
    rows.push({ id: href, title, company });
  }
  return rows;
}

function addressFrom(text: string) {
  const street = text.match(
    /([A-ZÄÖÜ][\p{L}\p{N}.\- ]{2,48}?(?:straße|strasse|str\.|platz|weg|allee|damm|ufer)\s+\d+\w*)/iu,
  )?.[1];
  const plz = text.match(/\b(1[0-4]\d{3})\b/)?.[1] ?? "";
  const area = text.match(/\b1[0-4]\d{3}\s+Berlin(?:\s+-\s+([A-ZÄÖÜ][\p{L}\- ]{2,40}))?/u)?.[1]?.trim() ?? "";
  return { street: street?.replace(/\s+/g, " ").trim() ?? "", plz, area };
}

export async function fetchJobsAndJoyNear(
  latitude: number,
  longitude: number,
  radiusKm: number,
  hints: string[],
  onJob: (job: NormalizedJob) => Promise<void>,
  onOpened?: () => Promise<void>,
) {
  const seen = new Map<string, Row>();
  for (const url of lists) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) continue;
      if (onOpened) {
        const opened = onOpened;
        onOpened = undefined;
        await opened();
      }
      for (const row of rowsFrom(await response.text())) seen.set(row.id, row);
    } catch {
      continue;
    }
    await sleep(400);
  }

  const local = hints.map((hint) => hint.toLowerCase()).filter((hint) => hint.length >= 4);
  let opened = 0;
  for (const row of seen.values()) {
    if (opened >= 36) break;
    opened += 1;
    await sleep(300);
    const page = await fetch(`https://jobsnjoy.com/job-boards/${row.id}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!page?.ok) continue;
    const text = decode((await page.text()).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
    const place = addressFrom(text);
    const mentioned = local.some((hint) => text.toLowerCase().includes(hint));
    if (!mentioned || !place.street || !place.plz) continue;
    const point = await geocode(`${place.street}, ${place.plz} Berlin`);
    if (!point || !inBerlin(point.latitude, point.longitude)) continue;
    if (distanceKm(latitude, longitude, point.latitude, point.longitude) > radiusKm) continue;
    const at = text.toLowerCase().search(/stundenlohn|€\s*\/\s*std|pro stunde/);
    const titleAt = text.toLowerCase().indexOf(row.title.toLowerCase().slice(0, 40));
    const start = at >= 0 ? at : Math.max(0, titleAt);
    const snippet = text.slice(start, start + 420);
    const body = `${row.title} ${text.slice(0, 6000)}`;
    await onJob({
      sourceName: "jobsnjoy",
      externalId: row.id,
      title: row.title,
      company: row.company,
      category: categoryFrom(body),
      jobType: jobTypeFrom(body),
      summary: summaryFrom(snippet),
      address: [place.street, place.plz, place.area || "Berlin"].filter(Boolean).join(", "),
      city: "Berlin",
      area: place.area || "Berlin",
      latitude: point.latitude,
      longitude: point.longitude,
      sourceUrl: `https://jobsnjoy.com/job-boards/${row.id}`,
      postedAt: null,
      ...hoursFrom(body),
      ...moneyFrom(body),
      language: languageFrom(body),
    });
  }
}
