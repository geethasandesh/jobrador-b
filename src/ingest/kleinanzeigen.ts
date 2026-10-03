import { geocode } from "./geocode.js";
import { inBerlin, type NormalizedJob } from "./model.js";
import { distanceKm } from "../lib/geo.js";
import {
  categoryFrom,
  hoursFrom,
  jobTypeFrom,
  languageFrom,
  moneyFrom,
  summaryFrom,
} from "./normalize.js";

const searches = [
  "https://www.kleinanzeigen.de/s-jobs/berlin/minijob/k0c102l3331",
  "https://www.kleinanzeigen.de/s-jobs/berlin/aushilfe/k0c102l3331",
  "https://www.kleinanzeigen.de/s-jobs/berlin/werkstudent/k0c102l3331",
];

const headers = {
  Accept: "text/html",
  "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decode(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

type Hit = {
  id: string;
  href: string;
  title: string;
  description: string;
  area: string;
  plz: string;
};

function hitsFrom(html: string): Hit[] {
  const hits: Hit[] = [];
  const chunks = html.split("<article ").slice(1);
  for (const chunk of chunks) {
    const id = chunk.match(/data-adid="(\d+)"/)?.[1];
    const href = chunk.match(/data-href="([^"]+)"/)?.[1];
    if (!id || !href) continue;
    const json = chunk.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    let title = "";
    let description = "";
    if (json) {
      try {
        const parsed = JSON.parse(json) as { title?: string; description?: string };
        title = parsed.title?.trim() ?? "";
        description = parsed.description?.trim() ?? "";
      } catch {
        title = "";
      }
    }
    if (!title) title = decode(chunk.match(/<h3[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "");
    const place = chunk.match(/<span>(\d{5})\s+([^<]+)<\/span>/);
    if (!title || !place?.[1] || !place[2]) continue;
    hits.push({
      id,
      href,
      title: decode(title),
      description: decode(description),
      plz: place[1],
      area: decode(place[2]),
    });
  }
  return hits;
}

function companyFrom(text: string, area: string) {
  const workplace = text.match(/Arbeitsort:\s*([^,\n]+)/i)?.[1];
  if (workplace && workplace.trim().length > 1) return workplace.trim();
  const intro = text.match(/\b(?:Das|Der|Die)\s+([A-ZÄÖÜ][\p{L}0-9&'.\- ]{2,32}?)\s+ist\b/u)?.[1];
  if (intro && !/restaurant|café|cafe|team|stelle|job/i.test(intro)) return intro.trim();
  const named = text.match(/\b(?:Restaurant|Café|Cafe|Bistro|Bar|Imbiss|Hotel)\s+[A-ZÄÖÜ0-9][^,.\n]{1,40}/);
  if (named?.[0]) return named[0].trim();
  return area;
}

function landmarkFrom(text: string) {
  const near = text.match(
    /(?:nähe|nahe)\s+(?:vom|von|der|dem|des)?\s*([A-ZÄÖÜ][\p{L}\-]+(?:\s+[A-ZÄÖÜ][\p{L}\-]+){0,3})/iu,
  )?.[1];
  if (near && /platz|straße|strasse|weg|allee|damm|ufer/i.test(near)) return near.trim();
  const street = text.match(
    /\b([A-ZÄÖÜ][\p{L}\-.]{2,28}(?:straße|strasse|platz|weg|allee|damm|ufer)(?:\s+\d+\w*)?)/iu,
  )?.[1];
  return street?.trim() ?? null;
}

async function detail(href: string) {
  const url = href.startsWith("http") ? href : `https://www.kleinanzeigen.de${href}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return null;
  const html = await response.text();
  const latitude = Number(html.match(/property="og:latitude" content="([\d.]+)"/)?.[1]);
  const longitude = Number(html.match(/property="og:longitude" content="([\d.]+)"/)?.[1]);
  const street = decode(html.match(/itemprop="streetAddress">\s*([^<]+)/)?.[1] ?? "");
  const locality = decode(html.match(/itemprop="addressLocality">\s*([^<]+)/)?.[1] ?? "");
  const description = decode(
    html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1]
      ? ""
      : "",
  );
  const json = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((match) => match[1] ?? "")
    .find((block) => block.includes('"description"'));
  let longText = "";
  if (json) {
    try {
      longText = decode((JSON.parse(json) as { description?: string }).description ?? "");
    } catch {
      longText = "";
    }
  }
  return {
    url,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    street,
    locality,
    description: longText,
  };
}

export async function fetchKleinanzeigen(): Promise<NormalizedJob[]> {
  const jobs: NormalizedJob[] = [];
  await collectKleinanzeigen(searches, () => true, 80, undefined, async (job) => {
    jobs.push(job);
  });
  return jobs;
}

export async function fetchKleinanzeigenNear(
  latitude: number,
  longitude: number,
  radiusKm: number,
  places: Array<{ id: string; label: string }>,
  onJob: (job: NormalizedJob) => Promise<void>,
) {
  for (const place of places.slice(0, 3)) {
    const slug = slugFrom(place.label);
    const urls = ["minijob", "aushilfe", "werkstudent"].map(
      (term) => `https://www.kleinanzeigen.de/s-jobs/${slug}/${term}/k0c102l${place.id}`,
    );
    urls.push(`https://www.kleinanzeigen.de/s-jobs/${slug}/servicekraft/k0c110l${place.id}`);
    await collectKleinanzeigen(
      urls,
      (hit) => berlinPostal(hit.plz),
      8,
      { latitude, longitude, radiusKm },
      async (job) => {
        const gap = distanceKm(latitude, longitude, job.latitude, job.longitude);
        if (gap <= radiusKm) await onJob(job);
      },
    );
  }
}

function slugFrom(label: string) {
  const name = label.replace(/^\d{5}\s+/, "").split("-")[0]?.trim() || label;
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "");
}

function berlinPostal(plz: string) {
  const code = Number(plz);
  return code >= 10115 && code <= 14199;
}

async function collectKleinanzeigen(
  urls: string[],
  keep: (hit: Hit) => boolean,
  maxDetails: number,
  focus: { latitude: number; longitude: number; radiusKm: number } | undefined,
  onJob: (job: NormalizedJob) => Promise<void>,
) {
  const seen = new Map<string, Hit>();
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) continue;
      for (const hit of hitsFrom(await response.text())) {
        if (keep(hit)) seen.set(hit.id, hit);
      }
    } catch {
      continue;
    }
    await sleep(400);
  }

  let details = 0;
  for (const hit of seen.values()) {
    if (details >= maxDetails) break;
    details += 1;
    await sleep(350);
    const page = await detail(hit.href).catch(() => null);
    const text = `${hit.title} ${page?.description || hit.description}`;
    if (focus && /^(?:suche|sucht)\b/i.test(hit.title)) continue;
    let latitude = page?.latitude ?? null;
    let longitude = page?.longitude ?? null;
    if (latitude == null || longitude == null) {
      const point = await geocode(`${hit.plz} ${hit.area}, Berlin`);
      if (!point) continue;
      latitude = point.latitude;
      longitude = point.longitude;
    }
    const area = hit.area || "Berlin";
    let street = page?.street ?? "";
    if (
      focus &&
      distanceKm(focus.latitude, focus.longitude, latitude, longitude) > focus.radiusKm
    ) {
      const landmark = landmarkFrom(text);
      if (landmark) {
        const point = await geocode(`${landmark}, ${hit.plz} Berlin`);
        if (point && inBerlin(point.latitude, point.longitude)) {
          latitude = point.latitude;
          longitude = point.longitude;
          if (!street) street = landmark;
        }
      }
    }
    if (!inBerlin(latitude, longitude)) continue;
    await onJob({
      sourceName: "kleinanzeigen",
      externalId: hit.id,
      title: hit.title,
      company: companyFrom(text, area),
      category: categoryFrom(text),
      jobType: jobTypeFrom(text),
      summary: summaryFrom(page?.description || hit.description || hit.title),
      address: [street, hit.plz, page?.locality || area].filter(Boolean).join(", "),
      city: "Berlin",
      area,
      latitude,
      longitude,
      sourceUrl: page?.url ?? `https://www.kleinanzeigen.de${hit.href}`,
      postedAt: null,
      ...hoursFrom(text),
      ...moneyFrom(text),
      language: languageFrom(text),
    });
  }
}
