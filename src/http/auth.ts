import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../db/env.js";

type AuthUser = { id: string; email: string };

function loadAuthEnv() {
  const path = fileURLToPath(new URL("../../.env", import.meta.url));
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (key !== "SUPABASE_URL" && key !== "SUPABASE_ANON_KEY" && key !== "NEXT_PUBLIC_SUPABASE_ANON_KEY") continue;
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export async function optionalUser(header: string | undefined): Promise<string | null> {
  if (!header?.startsWith("Bearer ")) return null;
  const user = await userFromRequest(header);
  return "id" in user ? user.id : null;
}

export async function userFromRequest(
  header: string | undefined,
  denied = "Log in to continue.",
): Promise<AuthUser | { status: number; message: string }> {
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { status: 401, message: denied };

  loadAuthEnv();
  const supabaseUrl = (process.env.SUPABASE_URL ?? "https://auavlxwsnoegelrrehhy.supabase.co").replace(/\/$/, "");
  const apiKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!apiKey) return { status: 503, message: "Login check is not configured." };

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    return { status: 503, message: "Login check is unavailable." };
  }

  if (!response.ok) return { status: 401, message: denied };
  const body = (await response.json()) as { id?: string; email?: string };
  if (!body.id) return { status: 401, message: denied };
  return { id: body.id, email: body.email?.trim().toLowerCase() ?? "" };
}

export function isAdminEmail(email: string) {
  loadEnvFile();
  const configured = [process.env.ADMIN_EMAIL ?? "", process.env.ADMIN_EMAILS ?? ""]
    .join(",")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const admins = configured.length > 0 ? configured : (process.env.GMAIL_USER ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  return Boolean(email) && admins.includes(email.trim().toLowerCase());
}
