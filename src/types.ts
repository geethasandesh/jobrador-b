export const JOB_TYPES = [
  "MINIJOB",
  "WERKSTUDENT",
  "TEILZEIT",
  "STUDENT",
  "TEMPORARY",
  "INTERNSHIP",
  "OTHER",
] as const;

export const LEAD_JOB_TYPES = [...JOB_TYPES, "NOT_SURE"] as const;

export const DISCOVERY_CATEGORIES = [
  "restaurant",
  "cafe",
  "hotel",
  "retail",
  "warehouse",
  "logistics",
  "cleaning",
  "other",
] as const;

export const CATEGORIES = [
  "restaurant",
  "cafe",
  "retail",
  "warehouse",
  "logistics",
  "hotel",
  "cleaning",
  "delivery",
  "office",
  "customer_service",
  "event",
  "other",
] as const;

export const KINDS = ["job", "community_lead", "nearby_business"] as const;

export const LANGUAGE_FILTERS = [
  "english_friendly",
  "german_required",
  "german_basic",
  "unknown",
] as const;

export const SALARY_FILTERS = ["under_13", "13_15", "15_20", "20_plus"] as const;

export type JobType = (typeof JOB_TYPES)[number];
export type LeadJobType = (typeof LEAD_JOB_TYPES)[number];
export type Category = (typeof CATEGORIES)[number];
export type Kind = (typeof KINDS)[number];
export type LanguageFilter = (typeof LANGUAGE_FILTERS)[number];
export type SalaryFilter = (typeof SALARY_FILTERS)[number];
export type ListingStatus = "ACTIVE" | "EXPIRED" | "REMOVED" | "UNCERTAIN";
export type Vote = "yes" | "no" | "unsure" | "done";

export type LanguageRequirement = {
  german?: "basic" | "required" | "fluent";
  english?: "helpful" | "required";
};

export type Business = {
  id: string;
  name: string;
  category: Category;
  address: string;
  city: string;
  area: string;
  latitude: number;
  longitude: number;
  postalCode?: string;
  phone?: string;
  website?: string;
  openingHours?: string;
  source: string;
  sourceId?: string;
  hiringCheckedAt?: string;
  distanceKm?: number | null;
};

export type Job = {
  id: string;
  businessId: string;
  title: string;
  jobType: JobType;
  category: Category;
  descriptionSummary: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryPeriod?: "hour" | "month";
  hoursMin?: number;
  hoursMax?: number;
  language?: LanguageRequirement;
  latitude: number;
  longitude: number;
  sourceName: string;
  sourceUrl: string;
  postedAt: string;
  status: ListingStatus;
};

export type CommunityLead = {
  id: string;
  businessId?: string;
  businessName: string;
  title: string;
  description: string;
  jobType: LeadJobType;
  category: Category;
  address: string;
  city: string;
  area: string;
  latitude: number;
  longitude: number;
  reportedAt: string;
  confirmYes: number;
  confirmNo: number;
  confirmUnsure: number;
  confirmDone: number;
  status: "ACTIVE" | "EXPIRED" | "REMOVED" | "FILLED";
  poster: "student" | "business";
  language?: LanguageRequirement;
  salaryMin?: number;
  salaryPeriod?: "hour" | "month";
  hoursMin?: number;
  hoursMax?: number;
};

export type SearchQuery = {
  latitude: number;
  longitude: number;
  radiusKm: number;
  q?: string;
  jobType?: JobType;
  category?: Category;
  kinds: Kind[];
  language?: LanguageFilter;
  salary?: SalaryFilter;
  sort: "distance" | "newest";
};

export type Opportunity = {
  id: string;
  kind: Kind;
  title: string;
  businessId?: string;
  businessName: string;
  category: Category;
  jobType: JobType | LeadJobType | null;
  summary: string;
  salaryLabel: string | null;
  languageLabel: string | null;
  hoursLabel: string | null;
  latitude: number;
  longitude: number;
  distanceKm: number;
  recency: string | null;
  area: string;
  address: string;
  status: string;
  confirmYes?: number;
  confirmNo?: number;
  confirmUnsure?: number;
  sourceName?: string;
  hiring?: boolean;
  linkedJobId?: string;
  linkedJobTitle?: string;
  linkedJobType?: string | null;
  linkedJobIds?: string[];
  poster?: "student" | "business";
};

export type OpportunityListResponse = {
  dataSource: "mock" | "live";
  center: { latitude: number; longitude: number };
  radiusKm: number;
  total: number;
  items: Opportunity[];
};
