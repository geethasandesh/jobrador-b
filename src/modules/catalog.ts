import { mockBusinesses, mockJobs, mockLeads } from "../data/mock.js";
import { distanceKm, roundKm } from "../lib/geo.js";
import {
  hoursLabel,
  languageLabel,
  matchesLanguage,
  matchesSalary,
  salaryLabel,
} from "../lib/labels.js";
import type {
  Business,
  Category,
  CommunityLead,
  Job,
  JobType,
  Kind,
  LeadJobType,
  Opportunity,
  OpportunityListResponse,
  SearchQuery,
  Vote,
} from "../types.js";

const businesses: Business[] = mockBusinesses.map((business) => ({ ...business }));
const jobs: Job[] = mockJobs.map((job) => ({ ...job }));
const leads: CommunityLead[] = mockLeads.map((lead) => ({ ...lead }));

const DATA_SOURCE = "mock" as const;

export type CreateLeadInput = {
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

export type JobDetail = {
  dataSource: typeof DATA_SOURCE;
  job: Job & {
    salaryLabel: string | null;
    languageLabel: string | null;
    hoursLabel: string | null;
    distanceKm: number | null;
  };
  business: Business | null;
};

export type LeadDetail = {
  dataSource: typeof DATA_SOURCE;
  lead: CommunityLead & {
    salaryLabel: string | null;
    languageLabel: string | null;
    hoursLabel: string | null;
    distanceKm: number | null;
  };
  business: Business | null;
};

export type BusinessDetail = {
  dataSource: typeof DATA_SOURCE;
  business: Business & { distanceKm: number | null };
  jobs: Array<Job & { salaryLabel: string | null; distanceKm: number | null }>;
  leads: CommunityLead[];
};

function businessById(id: string): Business | undefined {
  return businesses.find((business) => business.id === id);
}

function toOpportunity(
  item: {
    id: string;
    kind: Kind;
    title: string;
    businessId?: string;
    businessName: string;
    category: Category;
    jobType: JobType | LeadJobType | null;
    summary: string;
    salaryMin?: number;
    salaryMax?: number;
    salaryPeriod?: "hour" | "month";
    hoursMin?: number;
    hoursMax?: number;
    language?: Job["language"];
    latitude: number;
    longitude: number;
    recency: string | null;
    area: string;
    address: string;
    status: string;
    confirmYes?: number;
    confirmNo?: number;
    confirmUnsure?: number;
    sourceName?: string;
  },
  originLat: number,
  originLng: number,
): Opportunity {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    businessId: item.businessId,
    businessName: item.businessName,
    category: item.category,
    jobType: item.jobType,
    summary: item.summary,
    salaryLabel: salaryLabel(item.salaryMin, item.salaryMax, item.salaryPeriod),
    languageLabel: languageLabel(item.language),
    hoursLabel: hoursLabel(item.hoursMin, item.hoursMax),
    latitude: item.latitude,
    longitude: item.longitude,
    distanceKm: roundKm(distanceKm(originLat, originLng, item.latitude, item.longitude)),
    recency: item.recency,
    area: item.area,
    address: item.address,
    status: item.status,
    confirmYes: item.confirmYes,
    confirmNo: item.confirmNo,
    confirmUnsure: item.confirmUnsure,
    sourceName: item.sourceName,
  };
}

function textMatches(query: string, parts: Array<string | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return parts.some((part) => part?.toLowerCase().includes(needle));
}

export function searchOpportunities(query: SearchQuery): OpportunityListResponse {
  const items: Opportunity[] = [];

  if (query.kinds.includes("job")) {
    for (const job of jobs) {
      if (job.status !== "ACTIVE") continue;
      const business = businessById(job.businessId);
      if (query.jobType && job.jobType !== query.jobType) continue;
      if (query.category && job.category !== query.category) continue;
      if (query.language && !matchesLanguage(job.language, query.language)) continue;
      if (
        query.salary &&
        !matchesSalary(job.salaryMin, job.salaryMax, query.salary)
      ) {
        continue;
      }
      if (
        !textMatches(query.q ?? "", [
          job.title,
          business?.name,
          business?.area,
          job.category,
          job.descriptionSummary,
        ])
      ) {
        continue;
      }
      const distance = distanceKm(
        query.latitude,
        query.longitude,
        job.latitude,
        job.longitude,
      );
      if (distance > query.radiusKm) continue;
      items.push(
        toOpportunity(
          {
            id: job.id,
            kind: "job",
            title: job.title,
            businessId: job.businessId,
            businessName: business?.name ?? "Unknown business",
            category: job.category,
            jobType: job.jobType,
            summary: job.descriptionSummary,
            salaryMin: job.salaryMin,
            salaryMax: job.salaryMax,
            salaryPeriod: job.salaryPeriod,
            hoursMin: job.hoursMin,
            hoursMax: job.hoursMax,
            language: job.language,
            latitude: job.latitude,
            longitude: job.longitude,
            recency: job.postedAt,
            area: business?.area ?? "",
            address: business?.address ?? "",
            status: job.status,
            sourceName: job.sourceName,
          },
          query.latitude,
          query.longitude,
        ),
      );
    }
  }

  if (query.kinds.includes("community_lead") && !query.salary) {
    for (const lead of leads) {
      if (lead.status !== "ACTIVE") continue;
      if (query.jobType && lead.jobType !== query.jobType) continue;
      if (query.category && lead.category !== query.category) continue;
      if (query.language && !matchesLanguage(lead.language, query.language)) continue;
      if (
        !textMatches(query.q ?? "", [
          lead.title,
          lead.businessName,
          lead.area,
          lead.category,
          lead.description,
        ])
      ) {
        continue;
      }
      const distance = distanceKm(
        query.latitude,
        query.longitude,
        lead.latitude,
        lead.longitude,
      );
      if (distance > query.radiusKm) continue;
      items.push(
        toOpportunity(
          {
            id: lead.id,
            kind: "community_lead",
            title: lead.title,
            businessId: lead.businessId,
            businessName: lead.businessName,
            category: lead.category,
            jobType: lead.jobType,
            summary: lead.description,
            salaryMin: lead.salaryMin,
            salaryPeriod: lead.salaryPeriod,
            hoursMin: lead.hoursMin,
            hoursMax: lead.hoursMax,
            language: lead.language,
            latitude: lead.latitude,
            longitude: lead.longitude,
            recency: lead.reportedAt,
            area: lead.area,
            address: lead.address,
            status: lead.status,
            confirmYes: lead.confirmYes,
            confirmNo: lead.confirmNo,
            confirmUnsure: lead.confirmUnsure,
          },
          query.latitude,
          query.longitude,
        ),
      );
    }
  }

  if (
    query.kinds.includes("nearby_business") &&
    !query.salary &&
    !query.jobType &&
    (!query.language || query.language === "unknown")
  ) {
    for (const business of businesses) {
      const hasActiveJob = jobs.some(
        (job) => job.businessId === business.id && job.status === "ACTIVE",
      );
      const hasActiveLead = leads.some(
        (lead) => lead.businessId === business.id && lead.status === "ACTIVE",
      );
      if (hasActiveJob || hasActiveLead) continue;
      if (query.category && business.category !== query.category) continue;
      if (
        !textMatches(query.q ?? "", [
          business.name,
          business.area,
          business.category,
          business.address,
        ])
      ) {
        continue;
      }
      const distance = distanceKm(
        query.latitude,
        query.longitude,
        business.latitude,
        business.longitude,
      );
      if (distance > query.radiusKm) continue;
      items.push(
        toOpportunity(
          {
            id: business.id,
            kind: "nearby_business",
            title: business.name,
            businessId: business.id,
            businessName: business.name,
            category: business.category,
            jobType: null,
            summary: "No public vacancy found. You can visit and ask if they are hiring.",
            latitude: business.latitude,
            longitude: business.longitude,
            recency: null,
            area: business.area,
            address: business.address,
            status: "NO_VACANCY",
          },
          query.latitude,
          query.longitude,
        ),
      );
    }
  }

  items.sort((a, b) => {
    if (query.sort === "newest") {
      const aTime = a.recency ? Date.parse(a.recency) : 0;
      const bTime = b.recency ? Date.parse(b.recency) : 0;
      return bTime - aTime;
    }
    return a.distanceKm - b.distanceKm;
  });

  return {
    dataSource: DATA_SOURCE,
    center: { latitude: query.latitude, longitude: query.longitude },
    radiusKm: query.radiusKm,
    total: items.length,
    items,
  };
}

export function getJob(id: string, origin?: { latitude: number; longitude: number }): JobDetail | null {
  const job = jobs.find((item) => item.id === id);
  if (!job) return null;
  const business = businessById(job.businessId) ?? null;
  return {
    dataSource: DATA_SOURCE,
    job: {
      ...job,
      salaryLabel: salaryLabel(job.salaryMin, job.salaryMax, job.salaryPeriod),
      languageLabel: languageLabel(job.language),
      hoursLabel: hoursLabel(job.hoursMin, job.hoursMax),
      distanceKm: origin
        ? roundKm(distanceKm(origin.latitude, origin.longitude, job.latitude, job.longitude))
        : null,
    },
    business,
  };
}

export function getLead(
  id: string,
  origin?: { latitude: number; longitude: number },
): LeadDetail | null {
  const lead = leads.find((item) => item.id === id);
  if (!lead) return null;
  const business = lead.businessId ? businessById(lead.businessId) ?? null : null;
  return {
    dataSource: DATA_SOURCE,
    lead: {
      ...lead,
      salaryLabel: salaryLabel(lead.salaryMin, undefined, lead.salaryPeriod),
      languageLabel: languageLabel(lead.language),
      hoursLabel: hoursLabel(lead.hoursMin, lead.hoursMax),
      distanceKm: origin
        ? roundKm(
            distanceKm(origin.latitude, origin.longitude, lead.latitude, lead.longitude),
          )
        : null,
    },
    business,
  };
}

export function getBusiness(
  id: string,
  origin?: { latitude: number; longitude: number },
): BusinessDetail | null {
  const business = businessById(id);
  if (!business) return null;
  return {
    dataSource: DATA_SOURCE,
    business: {
      ...business,
      distanceKm: origin
        ? roundKm(
            distanceKm(
              origin.latitude,
              origin.longitude,
              business.latitude,
              business.longitude,
            ),
          )
        : null,
    },
    jobs: jobs
      .filter((job) => job.businessId === business.id)
      .map((job) => ({
        ...job,
        salaryLabel: salaryLabel(job.salaryMin, job.salaryMax, job.salaryPeriod),
        distanceKm: origin
          ? roundKm(distanceKm(origin.latitude, origin.longitude, job.latitude, job.longitude))
          : null,
      })),
    leads: leads.filter((lead) => lead.businessId === business.id),
  };
}

export function createLead(input: CreateLeadInput): LeadDetail {
  const lead: CommunityLead = {
    id: `lead_${Date.now().toString(36)}`,
    businessName: input.businessName,
    title: "Community hiring lead",
    description: input.description,
    jobType: input.jobType,
    category: input.category,
    address: input.address?.trim() || "Pinned location",
    city: "Berlin",
    area: input.area?.trim() || "Berlin",
    latitude: input.latitude,
    longitude: input.longitude,
    reportedAt: new Date().toISOString(),
    confirmYes: 0,
    confirmNo: 0,
    confirmUnsure: 0,
    status: "ACTIVE",
    salaryMin: input.salaryMin,
    salaryPeriod: input.salaryPeriod,
    hoursMin: input.hoursMin,
    hoursMax: input.hoursMax,
  };
  leads.unshift(lead);
  const detail = getLead(lead.id);
  if (!detail) {
    throw new Error("Lead was saved but could not be read back");
  }
  return detail;
}

export function confirmLead(id: string, vote: Vote): LeadDetail | null {
  const lead = leads.find((item) => item.id === id);
  if (!lead || lead.status !== "ACTIVE") return null;
  if (vote === "yes") lead.confirmYes += 1;
  if (vote === "no") lead.confirmNo += 1;
  if (vote === "unsure") lead.confirmUnsure += 1;
  return getLead(id);
}
