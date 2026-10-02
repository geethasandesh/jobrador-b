import {
  CATEGORIES,
  JOB_TYPES,
  KINDS,
  LANGUAGE_FILTERS,
  LEAD_JOB_TYPES,
  SALARY_FILTERS,
  type Category,
  type JobType,
  type Kind,
  type LanguageFilter,
  type LeadJobType,
  type SalaryFilter,
  type SearchQuery,
  type Vote,
} from "../types.js";

export type ParseFail = { error: string };

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

function optionalEnum<T extends string>(
  value: string | null,
  allowed: readonly T[],
  field: string,
): T | undefined | ParseFail {
  if (!value) return undefined;
  if (!isOneOf(value, allowed)) {
    return { error: `${field} must be one of: ${allowed.join(", ")}` };
  }
  return value;
}

export function parseSearch(url: URL): SearchQuery | ParseFail {
  const lat = Number(url.searchParams.get("lat") ?? "52.497");
  const lng = Number(url.searchParams.get("lng") ?? "13.423");
  const radiusKm = Number(url.searchParams.get("radiusKm") ?? "5");

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { error: "lat must be a number between -90 and 90" };
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { error: "lng must be a number between -180 and 180" };
  }
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 50) {
    return { error: "radiusKm must be a number between 0 and 50" };
  }

  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length > 80) return { error: "q must be 80 characters or fewer" };

  const jobType = optionalEnum(url.searchParams.get("jobType"), JOB_TYPES, "jobType");
  if (jobType && typeof jobType === "object") return jobType;

  const category = optionalEnum(url.searchParams.get("category"), CATEGORIES, "category");
  if (category && typeof category === "object") return category;

  const language = optionalEnum(
    url.searchParams.get("language"),
    LANGUAGE_FILTERS,
    "language",
  );
  if (language && typeof language === "object") return language;

  const salary = optionalEnum(url.searchParams.get("salary"), SALARY_FILTERS, "salary");
  if (salary && typeof salary === "object") return salary;

  const sortParam = url.searchParams.get("sort") ?? "distance";
  if (sortParam !== "distance" && sortParam !== "newest") {
    return { error: "sort must be distance or newest" };
  }

  const kindsParam = url.searchParams.get("kinds");
  let kinds: Kind[] = [...KINDS];
  if (kindsParam != null) {
    const requested = kindsParam.split(",").map((part) => part.trim()).filter(Boolean);
    if (requested.some((kind) => !isOneOf(kind, KINDS))) {
      return { error: `kinds must be a comma list of: ${KINDS.join(", ")}` };
    }
    kinds = requested as Kind[];
  }

  return {
    latitude: lat,
    longitude: lng,
    radiusKm,
    q: q || undefined,
    jobType: jobType as JobType | undefined,
    category: category as Category | undefined,
    kinds,
    language: language as LanguageFilter | undefined,
    salary: salary as SalaryFilter | undefined,
    sort: sortParam,
  };
}

export function parseOrigin(url: URL): { latitude: number; longitude: number } | undefined | ParseFail {
  const latRaw = url.searchParams.get("lat");
  const lngRaw = url.searchParams.get("lng");
  if (!latRaw && !lngRaw) return undefined;
  const latitude = Number(latRaw);
  const longitude = Number(lngRaw);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { error: "lat and lng must both be numbers" };
  }
  return { latitude, longitude };
}

export type CreateLeadBody = {
  businessName: string;
  description: string;
  jobType: LeadJobType;
  category: Category;
  latitude: number;
  longitude: number;
  address?: string;
  area?: string;
  salaryMin?: number;
  salaryPeriod?: "hour" | "month";
  hoursMin?: number;
  hoursMax?: number;
};

export function parseCreateLead(body: unknown): CreateLeadBody | ParseFail {
  if (!body || typeof body !== "object") return { error: "Expected a JSON object" };
  const input = body as Record<string, unknown>;

  const businessName = typeof input.businessName === "string" ? input.businessName.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (businessName.length < 2 || businessName.length > 80) {
    return { error: "businessName must be between 2 and 80 characters" };
  }
  if (description.length < 10 || description.length > 500) {
    return { error: "description must be between 10 and 500 characters" };
  }

  const jobType = typeof input.jobType === "string" ? input.jobType : "";
  if (!isOneOf(jobType, LEAD_JOB_TYPES)) {
    return { error: `jobType must be one of: ${LEAD_JOB_TYPES.join(", ")}` };
  }

  const category = typeof input.category === "string" ? input.category : "";
  if (!isOneOf(category, CATEGORIES)) {
    return { error: `category must be one of: ${CATEGORIES.join(", ")}` };
  }

  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { error: "latitude must be a number between -90 and 90" };
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { error: "longitude must be a number between -180 and 180" };
  }

  const address = typeof input.address === "string" ? input.address.trim() : undefined;
  const area = typeof input.area === "string" ? input.area.trim() : undefined;
  if (address && address.length > 160) return { error: "address is too long" };

  let salaryMin: number | undefined;
  if (input.salaryMin != null && input.salaryMin !== "") {
    salaryMin = Number(input.salaryMin);
    if (!Number.isFinite(salaryMin) || salaryMin <= 0 || salaryMin > 200) {
      return { error: "salaryMin must be a positive number up to 200" };
    }
  }

  const salaryPeriod =
    input.salaryPeriod == null || input.salaryPeriod === ""
      ? undefined
      : input.salaryPeriod;
  if (salaryPeriod != null && salaryPeriod !== "hour" && salaryPeriod !== "month") {
    return { error: "salaryPeriod must be hour or month" };
  }

  const hours = (value: unknown, field: string) => {
    if (value == null || value === "") return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 60) {
      return { error: `${field} must be between 0 and 60` } as ParseFail;
    }
    return parsed;
  };

  const hoursMin = hours(input.hoursMin, "hoursMin");
  if (hoursMin && typeof hoursMin === "object") return hoursMin;
  const hoursMax = hours(input.hoursMax, "hoursMax");
  if (hoursMax && typeof hoursMax === "object") return hoursMax;

  return {
    businessName,
    description,
    jobType,
    category,
    latitude,
    longitude,
    address: address || undefined,
    area: area || undefined,
    salaryMin,
    salaryPeriod,
    hoursMin: hoursMin as number | undefined,
    hoursMax: hoursMax as number | undefined,
  };
}

export function parseVote(body: unknown): Vote | ParseFail {
  if (!body || typeof body !== "object") return { error: "Expected a JSON object" };
  const status = (body as Record<string, unknown>).status;
  if (status !== "yes" && status !== "no" && status !== "unsure") {
    return { error: "status must be yes, no, or unsure" };
  }
  return status;
}
