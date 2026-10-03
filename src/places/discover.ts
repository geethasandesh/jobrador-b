import { businessesInRadius } from "../db/records.js";
import { getSql } from "../db/client.js";
import { savePlaces } from "../ingest/store.js";
import { distanceKm } from "../lib/geo.js";
import type { Business, Category } from "../types.js";
import { DISCOVERY_CATEGORIES } from "../types.js";
import { mockPlaces } from "./mock.js";
import { fetchOverpassPlaces } from "./overpass.js";

const FRESH_DAYS = 3;
const MAX_RADIUS_KM = 10;

const BERLIN_CENTERS = [
  { latitude: 52.497, longitude: 13.423 },
  { latitude: 52.516, longitude: 13.304 },
  { latitude: 52.522, longitude: 13.405 },
  { latitude: 52.481, longitude: 13.435 },
  { latitude: 52.515, longitude: 13.454 },
  { latitude: 52.543, longitude: 13.366 },
];

const inflight = new Map<string, Promise<number>>();

export type DiscoveryResult = {
  businesses: Array<Business & { distanceKm: number }>;
  fetched: number;
};

export async function findNearbyBusinesses(
  latitude: number,
  longitude: number,
  radiusKm: number,
  categories: Category[] = [...DISCOVERY_CATEGORIES],
  settle: "quick" | "full" = "quick",
): Promise<DiscoveryResult> {
  const radius = clampRadius(radiusKm);
  const wanted = normalizeCategories(categories);
  const missing = await missingCategories(latitude, longitude, radius, wanted);
  let fetched = 0;
  if (missing.length > 0) {
    const key = `${latitude.toFixed(3)}:${longitude.toFixed(3)}:${radius}:${missing.join("+")}`;
    let task = inflight.get(key);
    if (!task) {
      task = fetchAndStore(key, latitude, longitude, radius, missing).finally(() => inflight.delete(key));
      inflight.set(key, task);
    }
    if (settle === "full") fetched = await task;
    else await Promise.race([task, wait(9000)]);
  }
  const rows = await businessesInRadius(latitude, longitude, radius);
  const allowed = new Set(wanted);
  const businesses = rows
    .filter((business) => (business.source === "osm" || business.source === "mock") && allowed.has(business.category))
    .map((business) => ({
      ...business,
      distanceKm: distanceKm(latitude, longitude, business.latitude, business.longitude),
    }))
    .filter((business) => business.distanceKm <= radius)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  return { businesses, fetched };
}

export async function warmDiscoveryAreas() {
  let fetched = 0;
  for (const center of BERLIN_CENTERS) {
    const result = await findNearbyBusinesses(
      center.latitude,
      center.longitude,
      6,
      [...DISCOVERY_CATEGORIES],
      "full",
    );
    fetched += result.fetched;
  }
  return fetched;
}

async function fetchAndStore(
  id: string,
  latitude: number,
  longitude: number,
  radiusKm: number,
  categories: Category[],
) {
  const provider = process.env.PLACES_PROVIDER === "mock" ? "mock" : "osm";
  if (provider === "mock") {
    const places = mockPlaces(latitude, longitude, categories);
    const saved = await savePlaces(places, provider);
    await remember(id, latitude, longitude, radiusKm, categories, saved);
    return saved;
  }
  let saved = 0;
  const result = await fetchOverpassPlaces(latitude, longitude, radiusKm, categories, async (places, completed) => {
    saved += await savePlaces(places, provider);
    await remember(cacheId(latitude, longitude, radiusKm, completed), latitude, longitude, radiusKm, completed, places.length);
  });
  if (result.failed.length > 0) {
    await remember(
      cacheId(latitude, longitude, radiusKm, result.failed),
      latitude,
      longitude,
      radiusKm,
      result.failed,
      -1,
    );
  }
  return saved;
}

function cacheId(latitude: number, longitude: number, radiusKm: number, categories: Category[]) {
  return `${latitude.toFixed(3)}:${longitude.toFixed(3)}:${radiusKm}:${[...categories].sort().join("+")}`;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function remember(
  id: string,
  latitude: number,
  longitude: number,
  radiusKm: number,
  categories: Category[],
  saved: number,
) {
  await getSql()`
    insert into place_fetches (id, latitude, longitude, radius_km, categories, fetched_at, place_count)
    values (
      ${id},
      ${latitude},
      ${longitude},
      ${radiusKm},
      ${categories.join(",")},
      now(),
      ${saved}
    )
    on conflict (id) do update set
      fetched_at = now(),
      place_count = excluded.place_count
  `;
}

async function missingCategories(latitude: number, longitude: number, radiusKm: number, categories: Category[]) {
  const rows = await getSql()<
    { latitude: number; longitude: number; radius_km: number; categories: string; place_count: number; fetched_at: Date | string }[]
  >`
    select latitude, longitude, radius_km, categories, place_count, fetched_at
    from place_fetches
    where fetched_at > now() - make_interval(days => ${FRESH_DAYS})
      and latitude between ${latitude - 0.25} and ${latitude + 0.25}
      and longitude between ${longitude - 0.4} and ${longitude + 0.4}
    limit 40
  `;
  const covered = new Set<string>();
  const now = Date.now();
  for (const row of rows) {
    const ageMs = now - new Date(row.fetched_at).getTime();
    const failed = Number(row.place_count) < 0;
    if (failed ? ageMs > 2 * 60 * 1000 : ageMs > FRESH_DAYS * 24 * 60 * 60 * 1000) continue;
    const gap = distanceKm(latitude, longitude, Number(row.latitude), Number(row.longitude));
    if (gap + radiusKm > Number(row.radius_km) + 1) continue;
    for (const category of row.categories.split(",")) covered.add(category);
  }
  return categories.filter((category) => !covered.has(category));
}

function normalizeCategories(categories: Category[]) {
  const allowed = new Set<string>(DISCOVERY_CATEGORIES);
  const picked = [...new Set(categories.filter((category) => allowed.has(category)))];
  return (picked.length > 0 ? picked : [...DISCOVERY_CATEGORIES]).sort();
}

function clampRadius(radiusKm: number) {
  if (!Number.isFinite(radiusKm)) return 5;
  return Math.min(MAX_RADIUS_KM, Math.max(0.5, radiusKm));
}
