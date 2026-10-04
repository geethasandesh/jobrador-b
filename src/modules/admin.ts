import { randomBytes } from "node:crypto";
import { getSql } from "../db/client.js";
import { listReferralQueue, type Referral } from "./referrals.js";

export type AdminAccount = {
  email: string;
  createdAt: string;
};

export type BugReport = {
  id: string;
  message: string;
  email: string | null;
  page: string | null;
  createdAt: string;
  handledAt: string | null;
};

export type AdminOverview = {
  counts: {
    users: number | null;
    referralsPending: number;
    referralsApproved: number;
    referralsDeclined: number;
    bugReports: number;
    bugsOpen: number;
    closuresPending: number;
    jobs: number;
    tips: number;
    businessPosts: number;
    wallNotes: number;
  };
  accounts: AdminAccount[] | null;
  referrals: { pending: Referral[]; history: Referral[] };
  bugs: BugReport[];
};

export async function saveBugReport(input: { message: string; email?: string; page?: string }) {
  const id = `bug_${randomBytes(8).toString("hex")}`;
  await getSql()`
    insert into bug_reports (id, message, reply_email, page)
    values (${id}, ${input.message}, ${input.email ?? null}, ${input.page || null})
  `;
  return { id };
}

export async function adminOverview(accountId: string): Promise<AdminOverview> {
  const db = getSql();
  const [referralRows, bugCount, bugsOpen, closuresPending, jobs, tips, businessPosts, wallNotes, bugs, referrals, people] = await Promise.all([
    db<{ status: string; count: number }[]>`
      select status, count(*)::int as count from referrals group by status
    `,
    db<{ count: number }[]>`select count(*)::int as count from bug_reports`,
    db<{ count: number }[]>`select count(*)::int as count from bug_reports where handled_at is null`,
    db<{ count: number }[]>`select count(*)::int as count from closure_reports where status = 'pending'`,
    db<{ count: number }[]>`select count(*)::int as count from jobs where status = 'ACTIVE'`,
    db<{ count: number }[]>`
      select count(*)::int as count from community_leads
      where status = 'ACTIVE' and poster = 'student'
    `,
    db<{ count: number }[]>`
      select count(*)::int as count from community_leads
      where status = 'ACTIVE' and poster = 'business'
    `,
    db<{ count: number }[]>`
      select count(*)::int as count from wall_notes
      where status = 'approved' and id not like 'wall_ex_%'
    `,
    db<{ id: string; message: string; reply_email: string | null; page: string | null; created_at: Date | string; handled_at: Date | string | null }[]>`
      select id, message, reply_email, page, created_at, handled_at
      from bug_reports
      order by created_at desc
      limit 50
    `,
    listReferralQueue(accountId),
    listAccounts(),
  ]);

  const tally = Object.fromEntries(referralRows.map((row) => [row.status, row.count]));
  return {
    counts: {
      users: people?.total ?? null,
      referralsPending: tally.pending ?? 0,
      referralsApproved: tally.approved ?? 0,
      referralsDeclined: tally.rejected ?? 0,
      bugReports: bugCount[0]?.count ?? 0,
      bugsOpen: bugsOpen[0]?.count ?? 0,
      closuresPending: closuresPending[0]?.count ?? 0,
      jobs: jobs[0]?.count ?? 0,
      tips: tips[0]?.count ?? 0,
      businessPosts: businessPosts[0]?.count ?? 0,
      wallNotes: wallNotes[0]?.count ?? 0,
    },
    accounts: people?.recent ?? null,
    referrals,
    bugs: bugs.map((row) => ({
      id: row.id,
      message: row.message,
      email: row.reply_email,
      page: row.page,
      createdAt: new Date(row.created_at).toISOString(),
      handledAt: row.handled_at ? new Date(row.handled_at).toISOString() : null,
    })),
  };
}

async function listAccounts(): Promise<{ total: number; recent: AdminAccount[] } | null> {
  try {
    const db = getSql();
    const totals = await db<{ count: number }[]>`select count(*)::int as count from auth.users`;
    const recent = await db<{ email: string | null; created_at: Date | string }[]>`
      select email, created_at from auth.users order by created_at desc limit 40
    `;
    return {
      total: totals[0]?.count ?? 0,
      recent: recent.map((row) => ({
        email: row.email ?? "No email",
        createdAt: new Date(row.created_at).toISOString(),
      })),
    };
  } catch {
    return null;
  }
}
