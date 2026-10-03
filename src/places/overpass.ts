import type { Category } from "../types.js";
import { DISCOVERY_CATEGORIES } from "../types.js";
import { inBerlin, type NormalizedPlace } from "../ingest/model.js";

const ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];
const USER_AGENT = "jobrador/0.1 (berlin student job map)";

const FILTERS: Record<(typeof DISCOVERY_CATEGORIES)[number], string[]> = {
  restaurant: ['["name"]["amenity"="restaurant"]', '["name"]["amenity"="fast_food"]'],
  cafe: ['["name"]["amenity"="cafe"]'],
  hotel: ['["name"]["tourism"="hotel"]', '["name"]["tourism"="hostel"]', '["name"]["tourism"="guest_house"]'],
  retail: [
    '["name"]["shop"="supermarket"]',
    '["name"]["shop"="convenience"]',
    '["name"]["shop"="bakery"]',
    '["name"]["shop"="clothes"]',
    '["name"]["shop"="department_store"]',
    '["name"]["shop"="variety_store"]',
    '["name"]["shop"="mall"]',
  ],
  warehouse: ['["name"]["building"="warehouse"]', '["name"]["industrial"="warehouse"]'],
  logistics: ['["name"]["office"="logistics"]', '["name"]["industrial"="logistics"]'],
  cleaning: ['["name"]["craft"="cleaning"]', '["name"]["shop"="dry_cleaning"]', '["name"]["shop"="laundry"]'],
  other: ['["name"]["shop"="hairdresser"]', '["name"]["shop"="beauty"]', '["name"]["leisure"="fitness_centre"]'],
};

const GROUPS: Array<{
  categories: Array<(typeof DISCOVERY_CATEGORIES)[number]>;
  limit: number;
  ways: boolean;
}> = [
  { categories: ["hotel"], limit: 80, ways: true },
  { categories: ["warehouse"], limit: 60, ways: true },
  { categories: ["logistics"], limit: 60, ways: false },
  { categories: ["cleaning"], limit: 80, ways: false },
  { categories: ["restaurant"], limit: 250, ways: false },
  { categories: ["cafe"], limit: 150, ways: false },
  { categories: ["retail"], limit: 200, ways: false },
  { categories: ["other"], limit: 120, ways: false },
];

type Element = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

export async function fetchOverpassPlaces(
  latitude: number,
  longitude: number,
  radiusKm: number,
  categories: Category[],
  onGroup?: (places: NormalizedPlace[], completed: Category[]) => Promise<void>,
): Promise<{ places: NormalizedPlace[]; completed: Category[]; failed: Category[] }> {
  const wanted = new Set(categories);
  const area = bbox(latitude, longitude, radiusKm);
  const places: NormalizedPlace[] = [];
  const completed: Category[] = [];
  const failed: Category[] = [];
  const seen = new Set<string>();
  let calls = 0;

  for (const group of GROUPS) {
    const groupCategories = group.categories.filter((category) => wanted.has(category));
    const filters = groupCategories.flatMap((category) => FILTERS[category]);
    if (filters.length === 0) continue;
    if (calls > 0) await wait(1100);
    calls += 1;
    try {
      let elements: Element[] = [];
      try {
        elements = await runQuery(filters, area, group.limit, group.ways);
      } catch (error) {
        if (!group.ways) throw error;
        if (calls > 0) await wait(1100);
        calls += 1;
        elements = await runQuery(filters, area, group.limit, false);
        const message = error instanceof Error ? error.message : "timed out";
        console.warn(`places: ${groupCategories.join(", ")} used nodes only (${message})`);
      }
      for (const element of elements) {
        const place = normalize(element);
        if (!place || seen.has(place.sourceId)) continue;
        seen.add(place.sourceId);
        places.push(place);
      }
      completed.push(...groupCategories);
      await onGroup?.(
        places.filter((place) => groupCategories.includes(place.category as (typeof DISCOVERY_CATEGORIES)[number])),
        groupCategories,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenStreetMap places failed";
      console.warn(`places: ${groupCategories.join(", ")} skipped (${message})`);
      failed.push(...groupCategories);
    }
  }

  return { places, completed, failed };
}

function bbox(latitude: number, longitude: number, radiusKm: number) {
  const latPad = radiusKm / 111.32;
  const lngPad = radiusKm / (111.32 * Math.cos((latitude * Math.PI) / 180));
  return `${latitude - latPad},${longitude - lngPad},${latitude + latPad},${longitude + lngPad}`;
}

async function runQuery(filters: string[], area: string, limit: number, ways: boolean) {
  const lines = filters.flatMap((filter) => {
    const statements = [`node${filter}(${area});`];
    if (ways) statements.push(`way${filter}(${area});`);
    return statements;
  });
  const body = `
[out:json][timeout:12];
(
  ${lines.join("\n  ")}
);
out center ${limit};
`;
  let lastError = "OpenStreetMap places failed";
  for (let index = 0; index < ENDPOINTS.length; index += 1) {
    const endpoint = ENDPOINTS[index];
    if (index > 0) await wait(1100);
    try {
      const response = await fetch(endpoint ?? "", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "User-Agent": USER_AGENT,
        },
        body,
        signal: AbortSignal.timeout(18_000),
      });
      if (!response.ok) {
        lastError = `OpenStreetMap places failed (${response.status})`;
        continue;
      }
      const data = (await response.json()) as { elements?: Element[]; remark?: string };
      if (data.remark && (data.elements?.length ?? 0) === 0) {
        lastError = data.remark.slice(0, 160);
        continue;
      }
      return data.elements ?? [];
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  throw new Error(lastError);
}

function normalize(element: Element): NormalizedPlace | null {
  const tags = element.tags;
  const name = tags?.name?.trim();
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (!tags || !name || element.id == null || latitude == null || longitude == null) return null;
  if (!inBerlin(latitude, longitude)) return null;
  const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  const postalCode = tags["addr:postcode"]?.match(/\b\d{5}\b/)?.[0];
  const city = tags["addr:city"]?.trim() || "Berlin";
  const area = tags["addr:suburb"] || tags["addr:neighbourhood"] || tags["addr:district"] || city;
  const website = tags.website || tags["contact:website"];
  const sourceId = `${element.type ?? "node"}/${element.id}`;
  return {
    externalId: sourceId,
    sourceId,
    name,
    category: categoryOf(tags),
    address: [street, postalCode, city].filter(Boolean).join(", ") || city,
    city,
    postalCode,
    area,
    latitude,
    longitude,
    website: websiteUrl(website),
    phone: tags.phone || tags["contact:phone"] || tags["contact:mobile"],
  };
}

function categoryOf(tags: Record<string, string>): Category {
  const amenity = tags.amenity ?? "";
  const shop = tags.shop ?? "";
  const tourism = tags.tourism ?? "";
  const building = tags.building ?? "";
  const industrial = tags.industrial ?? "";
  const office = tags.office ?? "";
  const craft = tags.craft ?? "";
  const leisure = tags.leisure ?? "";
  if (tourism === "hotel" || tourism === "hostel" || tourism === "guest_house") return "hotel";
  if (building === "warehouse" || industrial === "warehouse") return "warehouse";
  if (office === "logistics" || industrial === "logistics") return "logistics";
  if (craft === "cleaning" || shop === "dry_cleaning" || shop === "laundry") return "cleaning";
  if (amenity === "cafe") return "cafe";
  if (amenity === "restaurant" || amenity === "fast_food") return "restaurant";
  if (shop === "bakery") return "cafe";
  if (/supermarket|convenience|clothes|department_store|variety_store|mall/.test(shop)) return "retail";
  return "other";
}

function websiteUrl(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("www.")) return `https://${trimmed}`;
  return undefined;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
