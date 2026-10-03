import { getSql } from "../db/client.js";
import { loadEnvFile } from "../db/env.js";
import { runIngest } from "./run.js";

loadEnvFile();

const report = await runIngest();
console.log(JSON.stringify(report, null, 2));
await getSql().end({ timeout: 5 });
if (report.errors.length > 0 && report.arbeitsagentur + report.kleinanzeigen === 0) {
  process.exitCode = 1;
}
