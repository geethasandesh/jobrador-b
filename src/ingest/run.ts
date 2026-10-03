import { fetchArbeitsagentur } from "./arbeitsagentur.js";
import { fetchCareerPages } from "./career-pages.js";
import { fetchKleinanzeigen } from "./kleinanzeigen.js";
import { warmDiscoveryAreas } from "../places/discover.js";
import { expireMissing, attachBusinessesToJobLocations, retireSample, saveJobs } from "./store.js";

export type IngestReport = {
  arbeitsagentur: number;
  kleinanzeigen: number;
  places: number;
  careerPages: number;
  expired: number;
  retiredJobs: number;
  retiredBusinesses: number;
  errors: string[];
};

let running = false;

function message(error: unknown) {
  return error instanceof Error ? error.message : "Unknown ingest error";
}

export async function runIngest(): Promise<IngestReport> {
  if (running) throw new Error("An ingest is already running");
  running = true;
  const report: IngestReport = {
    arbeitsagentur: 0,
    kleinanzeigen: 0,
    places: 0,
    careerPages: 0,
    expired: 0,
    retiredJobs: 0,
    retiredBusinesses: 0,
    errors: [],
  };

  try {
    try {
      const fetched = await fetchArbeitsagentur();
      report.arbeitsagentur = await saveJobs(fetched.jobs);
      if (fetched.complete && fetched.jobs.length > 0) {
        report.expired = await expireMissing(
          "arbeitsagentur",
          fetched.jobs.map((job) => job.externalId),
        );
      }
    } catch (error) {
      report.errors.push(`arbeitsagentur: ${message(error)}`);
    }

    try {
      report.kleinanzeigen = await saveJobs(await fetchKleinanzeigen());
    } catch (error) {
      report.errors.push(`kleinanzeigen: ${message(error)}`);
    }

    try {
      report.places = await warmDiscoveryAreas();
    } catch (error) {
      report.errors.push(`places: ${message(error)}`);
    }

    try {
      report.careerPages = await saveJobs(await fetchCareerPages());
    } catch (error) {
      report.errors.push(`career pages: ${message(error)}`);
    }

    if (report.arbeitsagentur + report.kleinanzeigen + report.careerPages > 0) {
      await attachBusinessesToJobLocations();
      const retired = await retireSample();
      report.retiredJobs = retired.jobs;
      report.retiredBusinesses = retired.businesses;
    }
    return report;
  } finally {
    running = false;
  }
}
