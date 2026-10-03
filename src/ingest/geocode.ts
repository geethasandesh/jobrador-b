const cache = new Map<string, { latitude: number; longitude: number } | null>();
let lastCall = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function geocode(query: string) {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "de");
  url.searchParams.set("q", query);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "jobrador/0.1 (berlin student job map)",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      cache.set(key, null);
      return null;
    }
    const rows = (await response.json()) as Array<{ lat?: string; lon?: string }>;
    const row = rows[0];
    if (!row?.lat || !row.lon) {
      cache.set(key, null);
      return null;
    }
    const point = { latitude: Number(row.lat), longitude: Number(row.lon) };
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
      cache.set(key, null);
      return null;
    }
    cache.set(key, point);
    return point;
  } catch {
    cache.set(key, null);
    return null;
  }
}

const reverseCache = new Map<string, { postcode: string | null; suburb: string | null } | null>();

export async function reverseGeocode(latitude: number, longitude: number) {
  const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  if (reverseCache.has(key)) return reverseCache.get(key) ?? null;

  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "jobrador/0.1 (berlin student job map)",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      reverseCache.set(key, null);
      return null;
    }
    const row = (await response.json()) as {
      address?: { postcode?: string; suburb?: string; neighbourhood?: string; quarter?: string; city_district?: string };
    };
    const address = row.address;
    const place = {
      postcode: address?.postcode?.match(/\d{5}/)?.[0] ?? null,
      suburb: address?.suburb || address?.neighbourhood || address?.quarter || address?.city_district || null,
    };
    reverseCache.set(key, place);
    return place;
  } catch {
    reverseCache.set(key, null);
    return null;
  }
}

const BERLIN_AREAS: Array<{ label: string; latitude: number; longitude: number }> = [
  { label: "Kreuzberg, Berlin", latitude: 52.498, longitude: 13.403 },
  { label: "Neukölln, Berlin", latitude: 52.481, longitude: 13.435 },
  { label: "Mitte, Berlin", latitude: 52.52, longitude: 13.405 },
  { label: "Wedding, Berlin", latitude: 52.542, longitude: 13.366 },
  { label: "Friedrichshain, Berlin", latitude: 52.515, longitude: 13.454 },
  { label: "Charlottenburg, Berlin", latitude: 52.516, longitude: 13.304 },
  { label: "Wilmersdorf, Berlin", latitude: 52.487, longitude: 13.32 },
  { label: "Schöneberg, Berlin", latitude: 52.486, longitude: 13.35 },
  { label: "Prenzlauer Berg, Berlin", latitude: 52.539, longitude: 13.413 },
  { label: "Moabit, Berlin", latitude: 52.526, longitude: 13.342 },
  { label: "Tiergarten, Berlin", latitude: 52.514, longitude: 13.36 },
  { label: "Steglitz, Berlin", latitude: 52.456, longitude: 13.322 },
  { label: "Spandau, Berlin", latitude: 52.536, longitude: 13.2 },
  { label: "Pankow, Berlin", latitude: 52.569, longitude: 13.401 },
  { label: "Lichtenberg, Berlin", latitude: 52.532, longitude: 13.499 },
  { label: "Reinickendorf, Berlin", latitude: 52.573, longitude: 13.349 },
  { label: "Tempelhof, Berlin", latitude: 52.467, longitude: 13.385 },
  { label: "Zehlendorf, Berlin", latitude: 52.434, longitude: 13.258 },
  { label: "Köpenick, Berlin", latitude: 52.446, longitude: 13.576 },
  { label: "Westend, Berlin", latitude: 52.517, longitude: 13.255 },
];

function inBerlin(latitude: number, longitude: number) {
  return latitude >= 52.33 && latitude <= 52.68 && longitude >= 13.05 && longitude <= 13.77;
}

export async function searchBerlinPlaces(query: string) {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const local = BERLIN_AREAS.filter((place) => place.label.toLowerCase().includes(needle)).slice(0, 6);
  if (local.length > 0 && !/^\d{5}$/.test(needle)) return local;
  const point = await geocode(/^\d{5}$/.test(needle) ? `${needle} Berlin` : `${query.trim()}, Berlin`);
  if (!point || !inBerlin(point.latitude, point.longitude)) return local;
  const label = /^\d{5}$/.test(needle) ? `${needle}, Berlin` : `${query.trim()}, Berlin`;
  if (local.some((place) => place.label.toLowerCase() === label.toLowerCase())) return local;
  return [{ label, latitude: point.latitude, longitude: point.longitude }, ...local].slice(0, 6);
}
