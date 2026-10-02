import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getSql } from "./client.js";

export async function migrate() {
  const path = fileURLToPath(new URL("../../db/migrations/001_init.sql", import.meta.url));
  const script = readFileSync(path, "utf8");
  await getSql().unsafe(script);
}
