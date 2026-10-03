import { geocode } from "./geocode.js";
import { inBerlin, type NormalizedJob } from "./model.js";
import { categoryFrom, hoursFrom, jobTypeFrom, languageFrom, summaryFrom } from "./normalize.js";

const SEARCH = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs";

const headers = {
  Accept: "application/json",
  "X-API-Key": "jobboerse-jobsuche",
  "User-Agent": "Jobsuche/2.9.2 (de.arbeitsagentur.jobboerse; build:1077; iOS 15.1.0) Alamofire/5.4.4",
};

type Location = {
  adresse?: { plz?: string; ort?: string; region?: string; strasse?: string };
  breite?: number;
  laenge?: number;
};

type Listing = {
  stellenangebotsTitel?: string;
  hauptberuf?: string;
  firma?: string;
  referenznummer?: string;
  externeURL?: string;
  datumErsteVeroeffentlichung?: string;
  istGeringfuegigeBeschaeftigung?: boolean;
  arbeitszeitVollzeit?: boolean;
  stellenangebotsart?: string;
  verguetungsangabe?: string;
  festgehalt?: number | string;
  stellenlokationen?: Location[];
};

type SearchResponse = {
  ergebnisliste?: Listing[];
  maxErgebnisse?: number;
};

const queries: Array<Record<string, string>> = [
  { wo: "Berlin", umkreis: "25", arbeitszeit: "mj", angebotsart: "1", zeitarbeit: "false", veroeffentlichtseit: "30" },
  { wo: "Berlin", umkreis: "25", was: "Werkstudent", angebotsart: "1", zeitarbeit: "false", veroeffentlichtseit: "30" },
  { wo: "Berlin", umkreis: "25", was: "Aushilfe", angebotsart: "1", zeitarbeit: "false", veroeffentlichtseit: "30" },
  { wo: "Berlin", umkreis: "25", angebotsart: "34", zeitarbeit: "false", veroeffentlichtseit: "30" },
];

async function searchPage(params: Record<string, string>, page: number) {
  const url = new URL(SEARCH);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", "100");
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Arbeitsagentur search failed (${response.status})`);
  return (await response.json()) as SearchResponse;
}

function pay(listing: Listing) {
  const amount = Number(listing.festgehalt);
  if (!Number.isFinite(amount) || amount <= 0) return {};
  const label = listing.verguetungsangabe ?? "";
  if (/STUNDE/i.test(label) && amount >= 8 && amount <= 40) {
    return { salaryMin: amount, salaryMax: amount, salaryPeriod: "hour" as const };
  }
  if (/MONAT/i.test(label) && amount >= 200 && amount <= 6000) {
    return { salaryMin: amount, salaryMax: amount, salaryPeriod: "month" as const };
  }
  return {};
}

async function toJob(listing: Listing): Promise<NormalizedJob | null> {
  const externalId = listing.referenznummer?.trim();
  const title = listing.stellenangebotsTitel?.trim();
  const company = listing.firma?.trim();
  if (!externalId || !title || !company) return null;

  const place = listing.stellenlokationen?.[0];
  const address = place?.adresse;
  const city = address?.ort?.trim() || "Berlin";
  if (!/berlin/i.test(`${city} ${address?.region ?? ""}`)) return null;

  let latitude = Number(place?.breite);
  let longitude = Number(place?.laenge);
  const street = address?.strasse?.trim();
  const plz = address?.plz?.trim() ?? "";
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    const query = [street, plz, city].filter(Boolean).join(" ");
    const point = await geocode(query);
    if (!point) return null;
    latitude = point.latitude;
    longitude = point.longitude;
  }
  if (!inBerlin(latitude, longitude)) return null;

  const text = `${title} ${listing.hauptberuf ?? ""}`;
  const fullTimeOnly =
    listing.arbeitszeitVollzeit === true &&
    !listing.istGeringfuegigeBeschaeftigung &&
    !/werkstudent|praktikum|teilzeit|minijob|aushilfe/i.test(text);
  if (fullTimeOnly) return null;

  const hours = hoursFrom(title);
  return {
    sourceName: "arbeitsagentur",
    externalId,
    title,
    company,
    category: categoryFrom(text),
    jobType: jobTypeFrom(text, {
      minijob: listing.istGeringfuegigeBeschaeftigung === true,
      internship: listing.stellenangebotsart === "PRAKTIKUM",
    }),
    summary: summaryFrom(listing.hauptberuf ? `${title}. ${listing.hauptberuf}` : title),
    address: [street, plz, city].filter(Boolean).join(", ") || city,
    city,
    area: city,
    latitude,
    longitude,
    sourceUrl:
      listing.externeURL?.trim() ||
      `https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(externalId)}`,
    postedAt: listing.datumErsteVeroeffentlichung
      ? new Date(listing.datumErsteVeroeffentlichung).toISOString()
      : null,
    ...pay(listing),
    ...hours,
    language: languageFrom(text),
  };
}

export async function fetchArbeitsagentur(): Promise<{ jobs: NormalizedJob[]; complete: boolean }> {
  const byId = new Map<string, NormalizedJob>();
  let complete = true;

  for (const params of queries) {
    for (let page = 1; page <= 4; page += 1) {
      const data = await searchPage(params, page);
      const list = data.ergebnisliste ?? [];
      if (list.length === 0) break;
      for (const listing of list) {
        const job = await toJob(listing);
        if (job) byId.set(job.externalId, job);
      }
      const max = Number(data.maxErgebnisse ?? 0);
      if (page * 100 >= max) break;
      if (page === 4) complete = false;
    }
  }

  return { jobs: [...byId.values()], complete };
}
