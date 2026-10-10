import { getSql } from "../db/client.js";
import { distanceKm } from "../lib/geo.js";
import { reverseGeocode } from "./geocode.js";
import { fetchJobsAndJoyNear } from "./jobsnjoy.js";
import { fetchKleinanzeigenNear } from "./kleinanzeigen.js";
import type { NormalizedJob } from "./model.js";
import { saveJobs } from "./store.js";

const FRESH_MS = 6 * 60 * 60 * 1000;
const areas = [
  ["Charlottenburg", 52.516, 13.304],
  ["Wilmersdorf", 52.487, 13.32],
  ["Schöneberg", 52.486, 13.35],
  ["Kreuzberg", 52.498, 13.403],
  ["Friedrichshain", 52.515, 13.454],
  ["Prenzlauer Berg", 52.539, 13.413],
  ["Mitte", 52.52, 13.405],
  ["Neukölln", 52.481, 13.435],
  ["Wedding", 52.542, 13.366],
  ["Moabit", 52.526, 13.342],
  ["Tiergarten", 52.514, 13.36],
  ["Steglitz", 52.456, 13.322],
  ["Spandau", 52.536, 13.2],
  ["Pankow", 52.569, 13.401],
  ["Lichtenberg", 52.532, 13.499],
  ["Reinickendorf", 52.573, 13.349],
  ["Tempelhof", 52.467, 13.385],
  ["Zehlendorf", 52.434, 13.258],
  ["Köpenick", 52.446, 13.576],
  ["Westend", 52.517, 13.255],
] as const;

const inflight = new Map<string, Promise<void>>();

const headers = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
};

type Place = { id: string; label: string };

export function circleListingsId(latitude: number, longitude: number, radiusKm: number) {
  const radius = Math.min(Math.max(radiusKm, 0.5), 10);
  return `listings:v4:${latitude.toFixed(2)}:${longitude.toFixed(2)}:${radius}`;
}

export async function circleListingsReady(latitude: number, longitude: number, radiusKm: number) {
  return fresh(circleListingsId(latitude, longitude, radiusKm));
}

export function startCircleListings(latitude: number, longitude: number, radiusKm: number) {
  const key = `${latitude.toFixed(2)}:${longitude.toFixed(2)}:${Math.round(radiusKm)}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const run = searchCircle(latitude, longitude, radiusKm)
    .catch(() => undefined)
    .finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

async function searchCircle(latitude: number, longitude: number, radiusKm: number) {
  const id = circleListingsId(latitude, longitude, radiusKm);
  const radius = Math.min(Math.max(radiusKm, 0.5), 10);
  if (await fresh(id)) return;

  const here = await reverseGeocode(latitude, longitude).catch(() => null);
  const names: string[] = [];
  if (here?.postcode) names.push(here.postcode);
  if (here?.suburb) names.push(here.suburb);
  for (const place of areas
    .map(([name, lat, lng]) => ({ name, gap: distanceKm(latitude, longitude, lat, lng) }))
    .filter((place) => place.gap <= radius + 1)
    .sort((left, right) => left.gap - right.gap)
    .slice(0, 3)) {
    names.push(place.name);
  }

  const places: Place[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const place = await locationId(name, here?.postcode ?? null);
    if (!place || seen.has(place.id)) continue;
    seen.add(place.id);
    places.push(place);
    if (places.length >= 3) break;
  }

  const hints = hintTokens([
    ...places.map((place) => place.label),
    ...names,
    here?.postcode ?? "",
    here?.suburb ?? "",
  ]);
  const flush = async (job: NormalizedJob) => {
    await saveJobs([job]);
  };
  let saved = false;
  const mark = async () => {
    if (saved) return;
    saved = true;
    await remember(id, latitude, longitude, radius);
  };

  if (places.length > 0) await fetchKleinanzeigenNear(latitude, longitude, radius, places, flush, mark);
  await fetchJobsAndJoyNear(latitude, longitude, radius, hints, flush, mark);
}

function hintTokens(values: string[]) {
  const tokens = new Set<string>();
  for (const value of values) {
    for (const part of value.split(/[^0-9A-Za-zÄÖÜäöüß]+/)) {
      if (/^berlin$/i.test(part)) continue;
      if (/^\d{5}$/.test(part) || part.length >= 5) tokens.add(part.toLowerCase());
    }
  }
  return [...tokens];
}

async function locationId(query: string, postcode: string | null): Promise<Place | null> {
  try {
    const response = await fetch(
      `https://www.kleinanzeigen.de/s-ort-empfehlungen.json?query=${encodeURIComponent(query)}`,
      { headers, signal: AbortSignal.timeout(12_000) },
    );
    if (!response.ok) return null;
    const rows = (await response.json()) as Record<string, string>;
    const entries = Object.entries(rows)
      .filter(([key, label]) => key !== "_0" && /berlin/i.test(label))
      .map(([key, label]) => ({ id: key.replace(/^_/, ""), label }));
    if (entries.length === 0) return null;
    if (postcode) {
      const exact = entries.find((entry) => entry.label.startsWith(postcode));
      if (exact) return exact;
    }
    const named = entries.find((entry) => entry.label.toLowerCase().includes(query.toLowerCase()));
    return named ?? entries[0] ?? null;
  } catch {
    return null;
  }
}

async function fresh(id: string) {
  const rows = await getSql()<{ fetched_at: Date | string }[]>`
    select fetched_at from place_fetches where id = ${id} limit 1
  `;
  const at = rows[0]?.fetched_at;
  if (!at) return false;
  return Date.now() - new Date(at).getTime() < FRESH_MS;
}

async function remember(id: string, latitude: number, longitude: number, radiusKm: number) {
  await getSql()`
    insert into place_fetches (id, latitude, longitude, radius_km, categories, fetched_at, place_count)
    values (${id}, ${latitude}, ${longitude}, ${radiusKm}, 'listings', now(), 1)
    on conflict (id) do update set fetched_at = now(), place_count = 1
  `;
}
