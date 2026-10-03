import { loadEnvFile } from "../db/env.js";

function supabaseAdmin() {
  loadEnvFile();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const supabaseUrl = (process.env.SUPABASE_URL ?? "https://auavlxwsnoegelrrehhy.supabase.co").replace(/\/$/, "");
  if (!serviceKey) return null;
  return { serviceKey, supabaseUrl };
}

export async function createConfirmedAccount(email: string, password: string) {
  const admin = supabaseAdmin();
  if (!admin) return { error: "Accounts are not set up yet." };

  let response: Response;
  try {
    response = await fetch(`${admin.supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: admin.serviceKey,
        Authorization: `Bearer ${admin.serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
      }),
    });
  } catch {
    return { error: "Could not create the account." };
  }

  if (response.ok) return { ok: true as const };

  const body = (await response.json().catch(() => ({}))) as { error_code?: string; msg?: string; message?: string };
  const detail = `${body.error_code ?? ""} ${body.msg ?? ""} ${body.message ?? ""}`.toLowerCase();
  if (response.status === 422 || detail.includes("already") || detail.includes("exists")) {
    return { error: "That email already has an account. Log in." };
  }
  return { error: "Could not create the account." };
}
