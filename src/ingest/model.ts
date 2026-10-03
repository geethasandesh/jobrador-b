import { createHash } from "node:crypto";
import type { Category, JobType, LanguageRequirement } from "../types.js";

export const LIVE_JOB_SOURCES = ["arbeitsagentur", "kleinanzeigen", "career_page", "jobsnjoy"] as const;

export type LiveJobSource = (typeof LIVE_JOB_SOURCES)[number];

export type NormalizedJob = {
  sourceName: LiveJobSource;
  externalId: string;
  title: string;
  company: string;
  category: Category;
  jobType: JobType;
  summary: string;
  address: string;
  city: string;
  area: string;
  latitude: number;
  longitude: number;
  sourceUrl: string;
  postedAt: string | null;
  salaryMin?: number;
  salaryMax?: number;
  salaryPeriod?: "hour" | "month";
  hoursMin?: number;
  hoursMax?: number;
  language?: LanguageRequirement;
  website?: string;
  businessId?: string;
};

export type NormalizedPlace = {
  externalId: string;
  name: string;
  category: Category;
  address: string;
  city: string;
  postalCode?: string;
  area: string;
  latitude: number;
  longitude: number;
  website?: string;
  phone?: string;
  sourceId: string;
};

export function stableId(prefix: string, value: string) {
  const clean = value.replace(/[^a-zA-Z0-9]/g, "");
  const body =
    clean.length > 0 && clean.length <= 48
      ? clean
      : createHash("sha256").update(value).digest("hex").slice(0, 24);
  return `${prefix}_${body}`;
}

export function inBerlin(latitude: number, longitude: number) {
  return latitude >= 52.33 && latitude <= 52.68 && longitude >= 13.05 && longitude <= 13.8;
}

export function clip(value: string, max: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}
