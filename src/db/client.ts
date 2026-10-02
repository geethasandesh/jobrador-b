import postgres from "postgres";
import { loadEnvFile } from "./env.js";

let sql: ReturnType<typeof postgres> | null = null;

export function databaseUrl(): string {
  loadEnvFile();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is missing. In Supabase open Project Settings → Database → Connection string → URI, then put that URI in jobrador-b/.env",
    );
  }
  return url;
}

export function getSql() {
  if (sql) return sql;
  const url = databaseUrl();
  sql = postgres(url, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
    ssl: url.includes("localhost") ? undefined : "require",
  });
  return sql;
}

export async function pingDatabase() {
  const db = getSql();
  await db`select postgis_version()`;
}
