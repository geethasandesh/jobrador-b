import { randomBytes } from "node:crypto";
import { getSql } from "../db/client.js";

const COLORS = ["#c6f56e", "#ff8ad4", "#6eb8f5", "#ffb56b", "#ffe56a", "#e2b0f6", "#8ee0cf"];
export const WALL_EMOJIS = ["❤️", "😄", "🔥", "👏"] as const;

export type WallReaction = {
  emoji: string;
  count: number;
  mine: boolean;
};

export type WallNote = {
  id: string;
  displayName: string;
  body: string;
  color: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reactions: WallReaction[];
};

type Row = {
  id: string;
  display_name: string;
  body: string;
  color: string;
  status: WallNote["status"];
  created_at: Date | string;
};

function toNote(row: Row): WallNote {
  return {
    id: row.id,
    displayName: row.display_name,
    body: row.body,
    color: row.color,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    reactions: WALL_EMOJIS.map((emoji) => ({ emoji, count: 0, mine: false })),
  };
}

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseWallNote(input: unknown): { displayName: string; body: string; color: string; deviceId: string } | { error: string } {
  if (!input || typeof input !== "object") return { error: "Expected a note." };
  const record = input as Record<string, unknown>;
  const displayName = cleanName(record.displayName);
  if (!displayName) return { error: "Add a first name, up to 20 letters." };
  const body = cleanBody(record.body);
  if (!body) return { error: "Write between 8 and 160 characters." };
  const color = typeof record.color === "string" ? record.color : "";
  if (!COLORS.includes(color)) return { error: "Pick a note color." };
  const deviceId = typeof record.deviceId === "string" ? record.deviceId.trim() : "";
  if (!DEVICE_ID.test(deviceId)) return { error: "The note could not be saved." };
  return { displayName, body, color, deviceId };
}

function cleanName(value: unknown) {
  if (typeof value !== "string") return "";
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 20) return "";
  if (!/^[\p{L}][\p{L}'’.\- ]*$/u.test(name)) return "";
  return name;
}

function cleanBody(value: unknown) {
  if (typeof value !== "string") return "";
  const body = value.replace(/\s+/g, " ").trim();
  if (body.length < 8 || body.length > 160) return "";
  if (/[<>]/.test(body) || /https?:|www\./i.test(body)) return "";
  return body;
}

export async function listFeaturedNotes(deviceId = ""): Promise<WallNote[]> {
  const rows = await getSql()<Row[]>`
    select id, display_name, body, color, status, created_at
    from wall_notes
    where status = 'approved'
    order by created_at desc
    limit 40
  `;
  const notes = rows.map(toNote);
  await attachReactions(notes, deviceId);
  return notes;
}

export async function noteForDevice(deviceId: string): Promise<WallNote | null> {
  if (!DEVICE_ID.test(deviceId)) return null;
  const rows = await getSql()<Row[]>`
    select id, display_name, body, color, status, created_at
    from wall_notes
    where device_id = ${deviceId}
    limit 1
  `;
  return rows[0] ? toNote(rows[0]) : null;
}

export async function stickNote(
  note: { displayName: string; body: string; color: string; deviceId: string },
): Promise<WallNote | { error: string; status: number }> {
  const id = `wall_${randomBytes(8).toString("hex")}`;
  try {
    const rows = await getSql()<Row[]>`
      insert into wall_notes (id, device_id, display_name, body, color, status)
      values (${id}, ${note.deviceId}, ${note.displayName}, ${note.body}, ${note.color}, 'approved')
      returning id, display_name, body, color, status, created_at
    `;
    const created = rows[0];
    if (!created) return { error: "The note could not be saved.", status: 500 };
    return toNote(created);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return { error: "You already stuck a note on the wall.", status: 409 };
    }
    throw error;
  }
}

export async function reactToNote(
  noteId: string,
  deviceId: string,
  emoji: string,
): Promise<WallReaction[] | { error: string; status: number }> {
  if (!DEVICE_ID.test(deviceId)) return { error: "The reaction could not be saved.", status: 400 };
  if (!WALL_EMOJIS.includes(emoji as (typeof WALL_EMOJIS)[number])) return { error: "Pick one of the reactions.", status: 400 };
  const notes = await getSql()<Row[]>`
    select id, display_name, body, color, status, created_at
    from wall_notes
    where id = ${noteId} and status = 'approved'
    limit 1
  `;
  if (!notes[0]) return { error: "That note is not on the wall.", status: 404 };
  const db = getSql();
  const current = await db<{ emoji: string }[]>`
    select emoji from wall_reactions where note_id = ${noteId} and device_id = ${deviceId} limit 1
  `;
  if (current[0]?.emoji === emoji) {
    await db`delete from wall_reactions where note_id = ${noteId} and device_id = ${deviceId}`;
  } else {
    await db`
      insert into wall_reactions (note_id, device_id, emoji)
      values (${noteId}, ${deviceId}, ${emoji})
      on conflict (note_id, device_id) do update set emoji = excluded.emoji
    `;
  }
  const note = toNote(notes[0]);
  await attachReactions([note], deviceId);
  return note.reactions;
}

async function attachReactions(notes: WallNote[], deviceId: string) {
  if (notes.length === 0) return;
  const db = getSql();
  const ids = notes.map((note) => note.id);
  const counts = await db<{ note_id: string; emoji: string; count: number }[]>`
    select note_id, emoji, count(*)::int as count
    from wall_reactions
    where note_id in ${db(ids)}
    group by note_id, emoji
  `;
  const mine = DEVICE_ID.test(deviceId)
    ? await db<{ note_id: string; emoji: string }[]>`
        select note_id, emoji from wall_reactions
        where device_id = ${deviceId} and note_id in ${db(ids)}
      `
    : [];
  for (const note of notes) {
    note.reactions = WALL_EMOJIS.map((emoji) => ({
      emoji,
      count: Number(counts.find((row) => row.note_id === note.id && row.emoji === emoji)?.count ?? 0),
      mine: mine.some((row) => row.note_id === note.id && row.emoji === emoji),
    }));
  }
}
