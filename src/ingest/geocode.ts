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
    if (!response.ok) return null;
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

type PlaceHit = { label: string; latitude: number; longitude: number };
type RankedPlace = PlaceHit & { name: string; berlin: boolean; kind: string };

const placeCache = new Map<string, { places: PlaceHit[]; outsideBerlin: boolean }>();

function fold(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

function levenshtein(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = i - 1;
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = row[j] ?? 0;
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      row[j] = Math.min(current + 1, (row[j - 1] ?? 0) + 1, previous + cost);
      previous = current;
    }
  }
  return row[right.length] ?? 0;
}

function closeName(query: string, name: string) {
  const left = fold(query);
  const right = fold(name);
  if (!left || !right) return false;
  if (left === right) return true;
  return levenshtein(left, right) <= (left.length >= 8 ? 2 : 1);
}

function startsWord(query: string, name: string) {
  const left = query.trim().toLowerCase();
  const right = name.trim().toLowerCase();
  if (!right.startsWith(left)) return false;
  const next = right[left.length];
  return next == null || /[^a-z0-9äöüß]/.test(next);
}

function mergePlaces(primary: PlaceHit[], extra: PlaceHit[]) {
  const seen = new Set(primary.map((place) => place.label.toLowerCase()));
  const merged = [...primary];
  for (const place of extra) {
    if (seen.has(place.label.toLowerCase())) continue;
    seen.add(place.label.toLowerCase());
    merged.push(place);
  }
  return merged.slice(0, 6);
}

function matchingAreas(needle: string) {
  return BERLIN_AREAS.filter((place) => {
    const area = place.label.split(",")[0] ?? place.label;
    return startsWord(needle, area) || (needle.length >= 3 && area.toLowerCase().includes(needle));
  }).slice(0, 6);
}

async function photonSearch(query: string, bias: boolean) {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "8");
  if (bias) {
    url.searchParams.set("lat", "52.52");
    url.searchParams.set("lon", "13.405");
  }
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "jobrador/0.1 (berlin student job map)",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: { name?: string; district?: string; locality?: string; osm_value?: string };
      }>;
    };
    const places: RankedPlace[] = [];
    const seen = new Set<string>();
    for (const feature of body.features ?? []) {
      const [longitude, latitude] = feature.geometry?.coordinates ?? [];
      const name = feature.properties?.name?.trim();
      if (!name || latitude == null || longitude == null) continue;
      const berlin = inBerlin(latitude, longitude);
      const key = `${name.toLowerCase()}:${berlin}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const district = feature.properties?.district || feature.properties?.locality;
      const label =
        berlin && district && district.toLowerCase() !== name.toLowerCase() ? `${name}, ${district}` : berlin ? `${name}, Berlin` : name;
      places.push({
        label,
        name,
        latitude,
        longitude,
        berlin,
        kind: feature.properties?.osm_value ?? "",
      });
    }
    return places;
  } catch {
    return null;
  }
}

async function nominatimPlace(query: string, local: PlaceHit[]) {
  const postal = /^\d{5}$/.test(query);
  const direct = await geocode(postal ? `${query} Berlin` : query);
  if (direct && !inBerlin(direct.latitude, direct.longitude)) {
    return { places: local.length > 0 ? local : [], outsideBerlin: local.length === 0 };
  }
  if (direct) {
    const label = postal ? `${query}, Berlin` : `${query}, Berlin`;
    return { places: mergePlaces([{ label, ...direct }], local), outsideBerlin: false };
  }
  if (postal) return { places: local, outsideBerlin: false };
  const narrowed = await geocode(`${query}, Berlin`);
  if (narrowed && inBerlin(narrowed.latitude, narrowed.longitude)) {
    return { places: mergePlaces([{ label: `${query}, Berlin`, ...narrowed }], local), outsideBerlin: false };
  }
  if (narrowed) return { places: [], outsideBerlin: local.length === 0 };
  return { places: local, outsideBerlin: false };
}

function namedBerlin(places: RankedPlace[], query: string) {
  return places.filter((place) => place.berlin && (closeName(query, place.name) || startsWord(query, place.name)));
}

function outsideHit(places: RankedPlace[], query: string) {
  return places.find((place) => {
    if (place.berlin) return false;
    if (closeName(query, place.name)) return true;
    return startsWord(query, place.name) && ["city", "town", "administrative", "municipality"].includes(place.kind);
  });
}

export async function searchBerlinPlaces(query: string) {
  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();
  if (needle.length < 2) return { places: [] as PlaceHit[], outsideBerlin: false };
  const cached = placeCache.get(needle);
  if (cached) return cached;

  const local = matchingAreas(needle);
  const [biased, open] = await Promise.all([photonSearch(trimmed, true), photonSearch(trimmed, false)]);
  let result: { places: PlaceHit[]; outsideBerlin: boolean };
  if (biased === null && open === null) {
    result = await nominatimPlace(trimmed, local);
  } else {
    const berlin = mergePlaces(
      namedBerlin(biased ?? [], trimmed).map(({ label, latitude, longitude }) => ({ label, latitude, longitude })),
      local,
    );
    if (berlin.length > 0) result = { places: berlin, outsideBerlin: false };
    else if (/^\d{5}$/.test(trimmed)) result = await nominatimPlace(trimmed, local);
    else if (outsideHit(open ?? [], trimmed) || outsideHit(biased ?? [], trimmed)) result = { places: [], outsideBerlin: true };
    else result = { places: [], outsideBerlin: false };
  }

  placeCache.set(needle, result);
  return result;
}
