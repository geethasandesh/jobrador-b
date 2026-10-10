import { createTransport } from "nodemailer";
import { loadEnvFile } from "../db/env.js";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function mailSettings() {
  loadEnvFile();
  const user = process.env.GMAIL_USER?.trim() ?? "";
  const pass = (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, "");
  if (!user || !pass) return null;
  return { user, pass };
}

const LIVE_SITE = "https://www.jobrador.online";

function configuredOrigins() {
  loadEnvFile();
  return (process.env.FRONTEND_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim().replace(/^['"]|['"]$/g, "").replace(/\/$/, ""))
    .filter(Boolean);
}

function isLocalOrigin(origin: string) {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

function isKnownSite(origin: string) {
  if (origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000") return true;
  try {
    const host = new URL(origin).host;
    return host === "jobrador.online"
      || host === "www.jobrador.online"
      || host === "jobrador-f.vercel.app"
      || (host.startsWith("jobrador-f") && host.endsWith(".vercel.app"));
  } catch {
    return false;
  }
}

export function siteOrigin(requested?: string | null) {
  const configured = configuredOrigins();
  const asked = requested?.trim().replace(/\/$/, "") ?? "";
  if (asked && (configured.includes(asked) || isKnownSite(asked))) return asked;
  return configured.find((origin) => !isLocalOrigin(origin)) ?? LIVE_SITE;
}

export async function sendMail(input: { to: string; subject: string; html: string; replyTo?: string }) {
  const config = mailSettings();
  if (!config) return { error: "Email is not set up yet." };
  const transport = createTransport({
    service: "gmail",
    auth: { user: config.user, pass: config.pass },
  });
  await transport.sendMail({
    from: `jobrador <${config.user}>`,
    to: input.to,
    subject: input.subject,
    html: input.html,
    replyTo: input.replyTo,
  });
  return { ok: true as const };
}

export async function sendPasswordReset(email: string, requestedOrigin?: string | null) {
  loadEnvFile();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const supabaseUrl = (process.env.SUPABASE_URL ?? "https://auavlxwsnoegelrrehhy.supabase.co").replace(/\/$/, "");
  const origin = siteOrigin(requestedOrigin);
  if (!serviceKey || !mailSettings()) return { error: "Password email is not set up yet." };

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "recovery",
        email,
        redirect_to: `${origin}/login/update-password`,
      }),
    });
  } catch {
    return { error: "Could not create the reset link." };
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error_code?: string; msg?: string };
    const code = `${body.error_code ?? ""} ${body.msg ?? ""}`.toLowerCase();
    if (response.status === 404 || code.includes("not found") || code.includes("user_not_found")) {
      return { ok: true as const };
    }
    return { error: "Could not create the reset link." };
  }

  const body = (await response.json()) as { action_link?: string; properties?: { action_link?: string } };
  const link = body.properties?.action_link ?? body.action_link;
  if (!link) return { error: "Could not create the reset link." };

  const reportUrl = `${origin}/report-a-bug`;
  const sent = await sendMail({
    to: email,
    subject: "Reset your jobrador password",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #222; max-width: 560px;">
        <h1 style="font-size: 22px;">Reset your password</h1>
        <p>A password reset was requested for ${escapeHtml(email)}.</p>
        <p><a href="${escapeHtml(link)}">Choose a new password</a></p>
        <p>If you did not ask for this, you can ignore the email.</p>
        <p style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #e5e5e5; font-size: 14px;">
          Something broken on the site? <a href="${escapeHtml(reportUrl)}">Report a bug</a>
        </p>
      </div>
    `,
  });
  if ("error" in sent) return sent;
  return { ok: true as const };
}

export async function sendHiringNotice(
  email: string,
  input: { placeName: string; titles: string[]; jobUrl: string },
) {
  const titles = input.titles.map((title) => `<li>${escapeHtml(title)}</li>`).join("");
  return sendMail({
    to: email,
    subject: `${input.placeName} has a public posting`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #222; max-width: 560px;">
        <h1 style="font-size: 22px;">A place you saved has a public posting</h1>
        <p>${escapeHtml(input.placeName)} now has a posting we can open.</p>
        <ul>${titles}</ul>
        <p><a href="${escapeHtml(input.jobUrl)}">Open it on the map</a></p>
      </div>
    `,
  });
}

export async function sendAreaAlert(
  email: string,
  input: { place: string; titles: string[]; mapUrl: string },
) {
  const place = input.place.replace(/, Berlin$/, "");
  const lines = input.titles.map((title) => `<li>${escapeHtml(title)}</li>`).join("");
  const subject = input.titles.length === 1 ? `New job in ${place}` : `${input.titles.length} new jobs in ${place}`;
  return sendMail({
    to: email,
    subject,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #222; max-width: 560px;">
        <h1 style="font-size: 22px;">${escapeHtml(subject)}</h1>
        <p>A new green pin appeared in ${escapeHtml(place)}, the area you asked to watch.</p>
        <ul>${lines}</ul>
        <p><a href="${escapeHtml(input.mapUrl)}">Open ${escapeHtml(place)} on the map</a></p>
      </div>
    `,
  });
}

export async function sendBugReport(input: { message: string; email?: string; page?: string }) {
  const config = mailSettings();
  if (!config) return { error: "Bug reports are not set up yet. Email info@grahmind.com instead." };
  const sent = await sendMail({
    to: config.user,
    replyTo: input.email,
    subject: "jobrador bug report",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #222; max-width: 560px;">
        <h1 style="font-size: 22px;">Bug report</h1>
        <p><strong>Page:</strong> ${escapeHtml(input.page || "Not given")}</p>
        <p><strong>Reply to:</strong> ${escapeHtml(input.email || "Not given")}</p>
        <p style="white-space: pre-wrap;">${escapeHtml(input.message)}</p>
      </div>
    `,
  });
  if ("error" in sent) return sent;
  return { ok: true as const };
}
