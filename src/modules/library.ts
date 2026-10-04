import { getSql } from "../db/client.js";

const KINDS = ["job", "community_lead", "nearby_business"] as const;
export type LibraryKind = (typeof KINDS)[number];

export type LibraryVisit = {
  id: string;
  kind: LibraryKind;
  title: string;
  subtitle: string;
  href: string;
};

export type LibraryState = {
  saved: Array<{ id: string; kind: LibraryKind }>;
  visits: LibraryVisit[];
};

const HREF = /^\/(?:jobs|leads|businesses)\/[A-Za-z0-9_-]+$/;

function asKind(value: unknown): LibraryKind | null {
  return KINDS.includes(value as LibraryKind) ? (value as LibraryKind) : null;
}

function cleanText(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > max || /[<>]/.test(text)) return "";
  return text;
}

export async function readLibrary(accountId: string): Promise<LibraryState> {
  const db = getSql();
  const [saved, visits] = await Promise.all([
    db<{ item_id: string; kind: LibraryKind }[]>`
      select item_id, kind from account_saves
      where account_id = ${accountId}
      order by created_at asc
    `,
    db<{ item_id: string; kind: LibraryKind; title: string; subtitle: string; href: string }[]>`
      select item_id, kind, title, subtitle, href from account_visits
      where account_id = ${accountId}
      order by created_at asc
    `,
  ]);
  return {
    saved: saved.map((row) => ({ id: row.item_id, kind: row.kind })),
    visits: visits.map((row) => ({
      id: row.item_id,
      kind: row.kind,
      title: row.title,
      subtitle: row.subtitle,
      href: row.href,
    })),
  };
}

async function kindForId(id: string, hinted: LibraryKind | null): Promise<LibraryKind> {
  const db = getSql();
  const [business, lead, job] = await Promise.all([
    db<{ id: string }[]>`select id from businesses where id = ${id} limit 1`,
    db<{ id: string }[]>`select id from community_leads where id = ${id} limit 1`,
    db<{ id: string }[]>`select id from jobs where id = ${id} limit 1`,
  ]);
  if (business[0]) return "nearby_business";
  if (lead[0]) return "community_lead";
  if (job[0]) return "job";
  return hinted ?? "job";
}

export async function mergeLibrary(
  accountId: string,
  input: { saved?: unknown; visits?: unknown },
): Promise<LibraryState> {
  const saved = Array.isArray(input.saved) ? input.saved.slice(0, 200) : [];
  const visits = Array.isArray(input.visits) ? input.visits.slice(0, 40) : [];
  for (const item of saved) {
    const id = item && typeof item === "object" ? cleanText((item as { id?: unknown }).id, 80) : "";
    if (!id) continue;
    const hinted = item && typeof item === "object" ? asKind((item as { kind?: unknown }).kind) : null;
    const kind = await kindForId(id, hinted);
    await getSql()`
      insert into account_saves (account_id, item_id, kind)
      values (${accountId}, ${id}, ${kind})
      on conflict (account_id, item_id) do nothing
    `;
  }
  for (const item of visits) {
    const visit = parseVisit(item);
    if (!visit) continue;
    await getSql()`
      insert into account_visits (account_id, item_id, kind, title, subtitle, href)
      values (${accountId}, ${visit.id}, ${visit.kind}, ${visit.title}, ${visit.subtitle}, ${visit.href})
      on conflict (account_id, item_id) do nothing
    `;
  }
  return readLibrary(accountId);
}

export async function setSaved(accountId: string, id: string, saved: boolean, hinted: LibraryKind | null) {
  const itemId = cleanText(id, 80);
  if (!itemId) return { error: "That save could not be stored." };
  if (!saved) {
    await getSql()`delete from account_saves where account_id = ${accountId} and item_id = ${itemId}`;
    return { ok: true as const };
  }
  const kind = await kindForId(itemId, hinted);
  await getSql()`
    insert into account_saves (account_id, item_id, kind)
    values (${accountId}, ${itemId}, ${kind})
    on conflict (account_id, item_id) do update set kind = excluded.kind
  `;
  return { ok: true as const };
}

function parseVisit(input: unknown): LibraryVisit | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const id = cleanText(record.id, 80);
  const kind = asKind(record.kind);
  const title = cleanText(record.title, 160);
  const subtitle = cleanText(record.subtitle, 160);
  const href = typeof record.href === "string" ? record.href.trim() : "";
  if (!id || !kind || !title || !subtitle || !HREF.test(href)) return null;
  return { id, kind, title, subtitle, href };
}

export async function addVisit(accountId: string, input: unknown) {
  const visit = parseVisit(input);
  if (!visit) return { error: "That visit could not be stored." };
  const count = await getSql()<{ count: number }[]>`
    select count(*)::int as count from account_visits where account_id = ${accountId}
  `;
  if ((count[0]?.count ?? 0) >= 40) return { error: "The visit list is full." };
  await getSql()`
    insert into account_visits (account_id, item_id, kind, title, subtitle, href)
    values (${accountId}, ${visit.id}, ${visit.kind}, ${visit.title}, ${visit.subtitle}, ${visit.href})
    on conflict (account_id, item_id) do update set
      kind = excluded.kind,
      title = excluded.title,
      subtitle = excluded.subtitle,
      href = excluded.href
  `;
  return { ok: true as const };
}

export async function removeVisit(accountId: string, id: string) {
  const itemId = cleanText(id, 80);
  if (!itemId) return { error: "That visit could not be removed." };
  await getSql()`delete from account_visits where account_id = ${accountId} and item_id = ${itemId}`;
  return { ok: true as const };
}
