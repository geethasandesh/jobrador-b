import { randomBytes } from "node:crypto";
import {
  addConfirmation,
  businessesInRadius,
  countRecentLeads,
  findBusiness,
  findJob,
  findLead,
  hasLiveJobs,
  insertLead,
  jobsForBusiness,
  jobsInRadius,
  jobsNear,
  leadsForAccount,
  leadsForBusiness,
  leadsInRadius,
  ownedLead,
  updateOwnedLead,
} from "../db/records.js";
import { distanceKm, roundKm } from "../lib/geo.js";
import { isLocality, samePlaceName } from "../lib/place-name.js";
import { findNearbyBusinesses } from "../places/discover.js";
import { circleListingsReady, startCircleListings } from "../ingest/circle-listings.js";
import { keepAlive } from "../http/keep-alive.js";
import { readableWebsite } from "../ingest/career-pages.js";
import { startHiringChecks } from "../places/hiring-check.js";
import { DISCOVERY_CATEGORIES } from "../types.js";
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

export type ListingSource = "mock" | "live";

export async function listingSource(): Promise<ListingSource> {
  return (await hasLiveJobs()) ? "live" : "mock";
}

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
  accountId: string;
  poster: "student" | "business";
};

export type JobDetail = {
  dataSource: ListingSource;
  job: Job & {
    salaryLabel: string | null;
    languageLabel: string | null;
    hoursLabel: string | null;
    distanceKm: number | null;
  };
  business: Business | null;
};

export type LeadDetail = {
  dataSource: ListingSource;
  lead: CommunityLead & {
    salaryLabel: string | null;
    languageLabel: string | null;
    hoursLabel: string | null;
    distanceKm: number | null;
    mine: boolean;
  };
  business: Business | null;
};

export type BusinessDetail = {
  dataSource: ListingSource;
  business: Business & { distanceKm: number | null };
  jobs: Array<Job & { salaryLabel: string | null; distanceKm: number | null }>;
  leads: CommunityLead[];
};

function businessById(list: Business[], id: string): Business | undefined {
  return list.find((business) => business.id === id);
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
    hiring?: boolean;
    linkedJobId?: string;
    linkedJobTitle?: string;
    linkedJobType?: string | null;
    linkedJobIds?: string[];
    poster?: "student" | "business";
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
    hiring: item.hiring,
    linkedJobId: item.linkedJobId,
    linkedJobTitle: item.linkedJobTitle,
    linkedJobType: item.linkedJobType,
    linkedJobIds: item.linkedJobIds,
    poster: item.poster,
  };
}

const DOOR_MATCH_KM = 2;

function isJobSeeker(title: string) {
  return /^(?:suche|sucht)\b/i.test(title) || /\bsucht\s+(?:einen\s+|eine\s+|ein\s+)?mini-?job/i.test(title);
}

function nameToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9äöüß]+/g, " ").trim().split(" ")[0] ?? "";
}

function nearestDoors(jobs: Job[], businesses: Business[]) {
  const byToken = new Map<string, Business[]>();
  for (const place of businesses) {
    if (place.source !== "osm" && place.source !== "mock") continue;
    const token = nameToken(place.name);
    if (token.length < 3) continue;
    const group = byToken.get(token);
    if (group) group.push(place);
    else byToken.set(token, [place]);
  }
  const pairs: Array<{ jobId: string; place: Business; gap: number }> = [];
  for (const job of jobs) {
    if (job.status !== "ACTIVE" || isJobSeeker(job.title)) continue;
    const employer = businessById(businesses, job.businessId);
    if (!employer || employer.source === "osm" || employer.source === "mock") continue;
    const candidates = byToken.get(nameToken(employer.name)) ?? [];
    for (const place of candidates) {
      if (!samePlaceName(employer.name, place.name)) continue;
      const gap = distanceKm(job.latitude, job.longitude, place.latitude, place.longitude);
      if (gap > DOOR_MATCH_KM) continue;
      pairs.push({ jobId: job.id, place, gap });
    }
  }
  pairs.sort((left, right) => left.gap - right.gap);
  const assigned = new Map<string, Business>();
  for (const pair of pairs) {
    if (assigned.has(pair.jobId)) continue;
    assigned.set(pair.jobId, pair.place);
  }
  return assigned;
}

function clip(value: string | null | undefined) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

function textMatches(query: string, parts: Array<string | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return parts.some((part) => part?.toLowerCase().includes(needle));
}

export async function searchOpportunities(query: SearchQuery): Promise<OpportunityListResponse> {
  const withText = Boolean(query.q?.trim());
  const boardsChecked = query.kinds.includes("nearby_business")
    ? await circleListingsReady(query.latitude, query.longitude, query.radiusKm).catch(() => false)
    : false;
  const [businesses, jobs, leads] = await Promise.all([
    businessesInRadius(query.latitude, query.longitude, query.radiusKm),
    jobsInRadius(query.latitude, query.longitude, query.radiusKm, withText),
    leadsInRadius(query.latitude, query.longitude, query.radiusKm, withText),
  ]);
  if (query.kinds.includes("job") || query.kinds.includes("nearby_business")) {
    keepAlive(startCircleListings(query.latitude, query.longitude, query.radiusKm));
  }
  if (query.kinds.includes("nearby_business")) {
    keepAlive(
      findNearbyBusinesses(query.latitude, query.longitude, query.radiusKm, [
        ...DISCOVERY_CATEGORIES,
      ]).catch(() => undefined),
    );
    keepAlive(startHiringChecks(query.latitude, query.longitude, query.radiusKm));
  }
  const doors = nearestDoors(jobs, businesses);
  const items: Opportunity[] = [];

  if (query.kinds.includes("job")) {
    for (const job of jobs) {
      if (job.status !== "ACTIVE") continue;
      if (isJobSeeker(job.title)) continue;
      const business = businessById(businesses, job.businessId);
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
      const door = doors.get(job.id);
      const doorInside =
        door != null &&
        distanceKm(query.latitude, query.longitude, door.latitude, door.longitude) <= query.radiusKm;
      const latitude = doorInside ? door.latitude : job.latitude;
      const longitude = doorInside ? door.longitude : job.longitude;
      const distance = distanceKm(query.latitude, query.longitude, latitude, longitude);
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
            summary: clip(job.descriptionSummary),
            salaryMin: job.salaryMin,
            salaryMax: job.salaryMax,
            salaryPeriod: job.salaryPeriod,
            hoursMin: job.hoursMin,
            hoursMax: job.hoursMax,
            language: job.language,
            latitude,
            longitude,
            recency: job.postedAt,
            area: (doorInside ? door.area : business?.area) || "",
            address: (doorInside ? door.address : business?.address) || "",
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
            summary: clip(lead.description),
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
            poster: lead.poster,
          },
          query.latitude,
          query.longitude,
        ),
      );
    }
  }

  if (query.kinds.includes("nearby_business")) {
    const claimed = new Set<string>();
    const restrictive = Boolean(query.salary || query.jobType || (query.language && query.language !== "unknown"));
    const discovered = businesses.filter((business) => business.source === "osm" || business.source === "mock");
    const employers = businesses.filter((business) => business.source !== "osm" && business.source !== "mock");

    const pushBusiness = (business: Business, requireJob: boolean) => {
      if (requireJob && isLocality(business.name)) return;
      if (query.category && business.category !== query.category) return;
      if (
        !textMatches(query.q ?? "", [
          business.name,
          business.area,
          business.category,
          business.address,
          business.postalCode,
        ])
      ) {
        return;
      }
      const distance = distanceKm(query.latitude, query.longitude, business.latitude, business.longitude);
      if (distance > query.radiusKm) return;
      const linked = jobs.filter((job) => {
        if (job.status !== "ACTIVE" || claimed.has(job.id) || isJobSeeker(job.title)) return false;
        if (query.jobType && job.jobType !== query.jobType) return false;
        if (query.language && query.language !== "unknown" && !matchesLanguage(job.language, query.language)) {
          return false;
        }
        if (query.salary && !matchesSalary(job.salaryMin, job.salaryMax, query.salary)) return false;
        if (job.businessId === business.id) return true;
        return doors.get(job.id)?.id === business.id;
      });
      const siteChecked = !readableWebsite(business.website) || Boolean(business.hiringCheckedAt);
      const looked = linked.length > 0 || (boardsChecked && siteChecked);
      if (!looked) {
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
              summary: "Checking job boards for this place.",
              latitude: business.latitude,
              longitude: business.longitude,
              recency: null,
              area: business.area,
              address: business.address,
              status: "UNCHECKED",
              hiring: false,
            },
            query.latitude,
            query.longitude,
          ),
        );
        return;
      }
      if (linked.length === 0 && (requireJob || restrictive)) return;
      for (const job of linked) claimed.add(job.id);
      const first = linked[0];
      items.push(
        toOpportunity(
          {
            id: business.id,
            kind: "nearby_business",
            title: business.name,
            businessId: business.id,
            businessName: business.name,
            category: business.category,
            jobType: first?.jobType ?? null,
            summary: first
              ? first.title
              : "The job boards are checked. You can walk in and ask.",
            latitude: business.latitude,
            longitude: business.longitude,
            recency: null,
            area: business.area,
            address: business.address,
            status: first ? "HIRING" : "NO_VACANCY",
            hiring: Boolean(first),
            linkedJobId: first?.id,
            linkedJobTitle: first?.title,
            linkedJobType: first?.jobType ?? null,
            linkedJobIds: linked.map((job) => job.id),
          },
          query.latitude,
          query.longitude,
        ),
      );
    };

    for (const business of discovered) pushBusiness(business, false);
    for (const business of employers) pushBusiness(business, true);
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
    dataSource: await listingSource(),
    center: { latitude: query.latitude, longitude: query.longitude },
    radiusKm: query.radiusKm,
    total: items.length,
    items,
  };
}

export async function getJob(
  id: string,
  origin?: { latitude: number; longitude: number },
): Promise<JobDetail | null> {
  const job = await findJob(id);
  if (!job) return null;
  const business = await findBusiness(job.businessId);
  return {
    dataSource: await listingSource(),
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

export async function getLead(
  id: string,
  origin?: { latitude: number; longitude: number },
  accountId?: string | null,
): Promise<(LeadDetail & { lead: LeadDetail["lead"] & { mine: boolean } }) | null> {
  const lead = await findLead(id);
  if (!lead) return null;
  const owner = await ownedLead(id);
  const business = lead.businessId ? await findBusiness(lead.businessId) : null;
  return {
    dataSource: await listingSource(),
    lead: {
      ...lead,
      mine: Boolean(accountId && owner?.account_id === accountId),
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

export async function getBusiness(
  id: string,
  origin?: { latitude: number; longitude: number },
): Promise<BusinessDetail | null> {
  const business = await findBusiness(id);
  if (!business) return null;
  const [directJobs, nearbyJobs, leads] = await Promise.all([
    jobsForBusiness(business.id),
    jobsNear(business.latitude, business.longitude, 2),
    leadsForBusiness(business.id),
  ]);
  const jobs = [...directJobs];
  for (const nearby of nearbyJobs) {
    if (jobs.some((job) => job.id === nearby.job.id)) continue;
    const sameDoor = nearby.job.businessId === business.id;
    const closeName = samePlaceName(nearby.businessName, business.name);
    if (sameDoor || closeName) jobs.push(nearby.job);
  }
  return {
    dataSource: await listingSource(),
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
    jobs: jobs.map((job) => ({
        ...job,
        salaryLabel: salaryLabel(job.salaryMin, job.salaryMax, job.salaryPeriod),
        distanceKm: origin
          ? roundKm(distanceKm(origin.latitude, origin.longitude, job.latitude, job.longitude))
          : null,
      })),
    leads,
  };
}

const DAILY_LEAD_CAP = 3;

export async function createLead(
  input: CreateLeadInput,
): Promise<LeadDetail | { error: string; status: number }> {
  const recent = await countRecentLeads(input.accountId);
  if (input.poster === "business" && !inBerlin(input.latitude, input.longitude)) {
    return { error: "Posting a job is only open in Berlin.", status: 400 };
  }
  if (recent >= DAILY_LEAD_CAP) {
    return {
      error: input.poster === "business" ? "This account already posted three jobs today." : "This account already shared three tips today.",
      status: 429,
    };
  }
  const lead: CommunityLead = {
    id: `lead_${randomBytes(8).toString("hex")}`,
    businessName: input.businessName,
    title: input.poster === "business" ? "Now hiring" : "Hiring tip",
    poster: input.poster,
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
    confirmDone: 0,
    status: "ACTIVE",
    salaryMin: input.salaryMin,
    salaryPeriod: input.salaryPeriod,
    hoursMin: input.hoursMin,
    hoursMax: input.hoursMax,
  };
  await insertLead(lead, input.accountId);
  const detail = await getLead(lead.id, undefined, input.accountId);
  if (!detail) {
    throw new Error("Lead was saved but could not be read back");
  }
  return detail;
}

export async function confirmLead(
  id: string,
  vote: Vote,
  accountId: string,
): Promise<(LeadDetail & { notice: string }) | null> {
  const result = await addConfirmation(id, vote, accountId);
  if (!result) return null;
  const detail = await getLead(id);
  if (!detail) return null;
  const filled = detail.lead.status === "FILLED";
  let notice = "Recorded. You can change this from the same account.";
  if (!result.changed) notice = "You already recorded that from this account.";
  else if (filled && !result.wasFilled) notice = "Updated. Hiring is finished, so this tip leaves the map.";
  else if (!filled && result.wasFilled) notice = "Updated. This tip is open again.";
  else if (vote === "done") {
    notice = "Recorded. Hiring is marked finished when you shared it, or when two accounts say so.";
  }
  return { ...detail, notice };
}

function inBerlin(latitude: number, longitude: number) {
  return latitude >= 52.33 && latitude <= 52.68 && longitude >= 13.05 && longitude <= 13.77;
}

export async function listMyPosts(accountId: string) {
  const leads = await leadsForAccount(accountId);
  return leads.map((lead) => ({
    id: lead.id,
    businessName: lead.businessName,
    title: lead.title,
    area: lead.area,
    status: lead.status,
    latitude: lead.latitude,
    longitude: lead.longitude,
    reportedAt: lead.reportedAt,
  }));
}

export async function manageOwnedLead(id: string, accountId: string, action: "stop" | "delete" | "reopen") {
  const row = await ownedLead(id);
  if (!row) return { error: "Post not found.", status: 404 as const };
  if (row.account_id !== accountId) {
    return { error: "You can only manage a post from the account that created it.", status: 403 as const };
  }
  if (row.status === "REMOVED") return { error: "This post was deleted.", status: 400 as const };
  if (action === "stop" && row.status !== "ACTIVE") return { error: "Hiring is already stopped.", status: 400 as const };
  if (action === "reopen" && row.status !== "FILLED") return { error: "This post is not stopped.", status: 400 as const };
  const next = action === "delete" ? "REMOVED" : action === "stop" ? "FILLED" : "ACTIVE";
  const updated = await updateOwnedLead(id, accountId, next);
  if (!updated) return { error: "You can only manage a post from the account that created it.", status: 403 as const };
  return { ok: true as const, status: next };
}
