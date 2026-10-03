import type { Category } from "../types.js";
import type { NormalizedPlace } from "../ingest/model.js";

const SAMPLES: Array<{ name: string; category: Category; north: number; east: number }> = [
  { name: "Cafe Beispiel", category: "cafe", north: 0.002, east: 0.001 },
  { name: "Restaurant Beispiel", category: "restaurant", north: -0.0015, east: 0.002 },
  { name: "Hotel Beispiel", category: "hotel", north: 0.001, east: -0.002 },
  { name: "Markt Beispiel", category: "retail", north: -0.002, east: -0.001 },
  { name: "Lager Beispiel", category: "warehouse", north: 0.003, east: 0.0004 },
  { name: "Logistik Beispiel", category: "logistics", north: -0.0008, east: 0.003 },
  { name: "Reinigung Beispiel", category: "cleaning", north: 0.0006, east: -0.0014 },
];

export function mockPlaces(
  latitude: number,
  longitude: number,
  categories: Category[],
): NormalizedPlace[] {
  const wanted = new Set(categories);
  return SAMPLES.filter((sample) => wanted.has(sample.category)).map((sample) => ({
    externalId: `mock/${sample.category}`,
    sourceId: `mock/${sample.category}`,
    name: sample.name,
    category: sample.category,
    address: "Beispielstraße 1, 10999 Berlin",
    city: "Berlin",
    postalCode: "10999",
    area: "Berlin",
    latitude: latitude + sample.north,
    longitude: longitude + sample.east,
    phone: undefined,
    website: undefined,
  }));
}
