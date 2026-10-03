import { loadEnvFile } from "../db/env.js";

type AuthUser = { id: string };

export async function userFromRequest(
  header: string | undefined,
  denied = "Log in to continue.",
): Promise<AuthUser | { status: number; message: string }> {
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { status: 401, message: denied };

  loadEnvFile();
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
  const body = (await response.json()) as { id?: string };
  if (!body.id) return { status: 401, message: denied };
  return { id: body.id };
}
