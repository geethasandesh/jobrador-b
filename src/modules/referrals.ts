import { randomBytes } from "node:crypto";
import { getSql } from "../db/client.js";

export type ReferralStatus = "pending" | "approved" | "rejected";

export type Referral = {
  id: string;
  authorName: string;
  message: string;
  url: string;
  status: ReferralStatus;
  createdAt: string;
  mine: boolean;
};

type Row = {
  id: string;
  account_id: string;
  author_name: string;
  message: string;
  url: string;
  status: ReferralStatus;
  created_at: Date | string;
};

const STATUSES = new Set<ReferralStatus>(["pending", "approved", "rejected"]);

function toReferral(row: Row, accountId: string): Referral {
  return {
    id: row.id,
    authorName: row.author_name,
    message: row.message,
    url: row.url,
    status: STATUSES.has(row.status) ? row.status : "pending",
    createdAt: new Date(row.created_at).toISOString(),
    mine: row.account_id === accountId,
  };
}

const URL_IN_TEXT = /(?:https?:\/\/|www\.)[^\s<>]+/gi;

export function parseReferral(input: unknown): { message: string; url: string } | { error: string } {
  if (!input || typeof input !== "object") return { error: "Expected a referral." };
  const raw = (input as { message?: unknown }).message;
  if (typeof raw !== "string") return { error: "Write a referral." };
  const message = raw.replace(/[ \t]+/g, " ").trim();
  if (message.length < 2 || message.length > 500) return { error: "Write a short referral." };
  if (/[<>]/.test(message)) return { error: "That note could not be sent." };
  let url = "";
  for (const hit of message.match(URL_IN_TEXT) ?? []) {
    const candidate = hit.replace(/[),.;]+$/, "");
    const withScheme = candidate.startsWith("www.") ? `https://${candidate}` : candidate;
    const cleaned = cleanUrl(withScheme);
    if (!cleaned) return { error: "Use a full https link. Local addresses are not posted." };
    if (!url) url = cleaned;
  }
  return { message, url };
}

export function authorFromEmail(email: string) {
  const local = email.split("@")[0] ?? "";
  const words = local
    .replace(/[._+-]+/g, " ")
    .replace(/[0-9]/g, "")
    .trim()
    .split(/\s+/)
    .filter((word) => /^[\p{L}][\p{L}'’.-]*$/u.test(word))
    .slice(0, 2);
  const name = words.join(" ").slice(0, 20);
  if (name.length < 2) return "Student";
  return name.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function cleanUrl(value: unknown) {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (raw.length < 12 || raw.length > 400) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host.endsWith(".local")) {
    return "";
  }
  return url.toString();
}

export async function listReferrals(accountId: string): Promise<Referral[]> {
  const rows = await getSql()<Row[]>`
    select id, account_id, author_name, message, url, status, created_at
    from referrals
    where status = 'approved' or account_id = ${accountId}
    order by created_at asc
    limit 200
  `;
  return rows.map((row) => toReferral(row, accountId));
}

export async function pendingCount(): Promise<number> {
  const rows = await getSql()<{ count: number }[]>`
    select count(*)::int as count from referrals where status = 'pending'
  `;
  return rows[0]?.count ?? 0;
}

export async function createReferral(
  accountId: string,
  email: string,
  input: { message: string; url: string },
): Promise<Referral | { error: string; status: number }> {
  const db = getSql();
  const recent = await db<{ count: number }[]>`
    select count(*)::int as count
    from referrals
    where account_id = ${accountId}
      and created_at > now() - interval '1 day'
  `;
  if ((recent[0]?.count ?? 0) >= 3) {
    return { error: "This account already sent three referrals today.", status: 429 };
  }
  const id = `ref_${randomBytes(8).toString("hex")}`;
  const rows = await db<Row[]>`
    insert into referrals (id, account_id, author_name, message, url, status)
    values (${id}, ${accountId}, ${authorFromEmail(email)}, ${input.message}, ${input.url}, 'pending')
    returning id, account_id, author_name, message, url, status, created_at
  `;
  const created = rows[0];
  if (!created) return { error: "The referral could not be saved.", status: 500 };
  return toReferral(created, accountId);
}

export async function listReferralQueue(accountId: string): Promise<{ pending: Referral[]; history: Referral[] }> {
  const rows = await getSql()<Row[]>`
    select id, account_id, author_name, message, url, status, created_at
    from referrals
    order by created_at desc
    limit 200
  `;
  const items = rows.map((row) => toReferral(row, accountId));
  return {
    pending: items.filter((item) => item.status === "pending").reverse(),
    history: items.filter((item) => item.status !== "pending"),
  };
}

export async function reviewReferral(
  id: string,
  accountId: string,
  action: "approve" | "reject",
): Promise<Referral | { error: string; status: number }> {
  if (!/^ref_[0-9a-f]{16}$/.test(id)) return { error: "That referral is not in the queue.", status: 404 };
  const status = action === "approve" ? "approved" : "rejected";
  const rows = await getSql()<Row[]>`
    update referrals
    set status = ${status}, reviewed_at = now()
    where id = ${id} and status = 'pending'
    returning id, account_id, author_name, message, url, status, created_at
  `;
  const updated = rows[0];
  if (!updated) return { error: "That referral is not waiting anymore.", status: 404 };
  return toReferral(updated, accountId);
}
