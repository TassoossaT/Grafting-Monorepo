import { execGhSync } from "../git/exec.ts";
import { withTempTextFile } from "./issue.ts";

/**
 * Repository milestones through the REST API: `gh` has no `milestone`
 * subcommand, so these go through `gh api`, which resolves `{owner}/{repo}`
 * from the checkout it runs in.
 */
const MILESTONES = "repos/{owner}/{repo}/milestones";

export type MilestoneState = "open" | "closed";

export interface MilestoneListInput {
  state?: MilestoneState | "all";
}

export interface MilestoneNewInput {
  title: string;
  description?: string;
  dueOn?: string;
}

export interface MilestoneUpdateInput {
  number: number | string;
  title?: string;
  description?: string;
  dueOn?: string;
  state?: MilestoneState;
}

export interface CompactMilestone {
  number: number;
  title: string;
  description?: string;
  state: string;
  dueOn?: string;
  openIssues: number;
  closedIssues: number;
  url: string;
}

interface RawMilestone {
  number: number;
  title: string;
  description: string | null;
  state: string;
  due_on: string | null;
  open_issues: number;
  closed_issues: number;
  html_url: string;
}

/** The value that clears a milestone's due date. */
const NO_DUE_DATE = "none";

function compactMilestone(raw: RawMilestone): CompactMilestone {
  return {
    number: raw.number,
    title: raw.title,
    description: raw.description || undefined,
    state: raw.state,
    dueOn: raw.due_on ? raw.due_on.slice(0, 10) : undefined,
    openIssues: raw.open_issues,
    closedIssues: raw.closed_issues,
    url: raw.html_url,
  };
}

/** `YYYY-MM-DD` as the timestamp the milestones API stores, or `undefined` if it is not a real calendar date. */
export function milestoneDueOn(date: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return undefined;
  return `${date}T00:00:00Z`;
}

/**
 * `gh api` field arguments for a milestone write, or an error message.
 *
 * `-f` sends every value as a raw string, so a title like `1.0` is not turned
 * into a number; only the due-date clear uses `-F`, whose `null` is JSON null.
 */
export function milestoneFields(
  input: Omit<MilestoneUpdateInput, "number" | "description">,
): { ok: true; args: string[] } | { ok: false; error: string } {
  const args: string[] = [];
  if (input.title !== undefined) {
    if (!input.title) return { ok: false, error: "milestone title cannot be empty" };
    args.push("-f", `title=${input.title}`);
  }
  if (input.state !== undefined) {
    if (input.state !== "open" && input.state !== "closed") {
      return { ok: false, error: `invalid milestone state "${input.state}": expected open or closed` };
    }
    args.push("-f", `state=${input.state}`);
  }
  if (input.dueOn !== undefined) {
    if (input.dueOn === NO_DUE_DATE) {
      args.push("-F", "due_on=null");
    } else {
      const dueOn = milestoneDueOn(input.dueOn);
      if (!dueOn) return { ok: false, error: `invalid due date "${input.dueOn}": expected YYYY-MM-DD or ${NO_DUE_DATE}` };
      args.push("-f", `due_on=${dueOn}`);
    }
  }
  return { ok: true, args };
}

/** Runs a milestone write, sending the description as a file so its length is never an argv problem. */
function writeMilestone(repoRoot: string, args: readonly string[], description: string | undefined): CompactMilestone {
  const raw = description === undefined
    ? execGhSync(args, { cwd: repoRoot })
    : withTempTextFile(description, (filePath) => execGhSync([...args, "-F", `description=@${filePath}`], { cwd: repoRoot }));
  return compactMilestone(JSON.parse(raw) as RawMilestone);
}

/** Lists repository milestones with their open and closed issue counts. */
export async function milestoneList(repoRoot: string, input: MilestoneListInput = {}) {
  const state = input.state ?? "open";
  if (state !== "open" && state !== "closed" && state !== "all") {
    return { ok: false as const, error: `invalid milestone state "${state}": expected open, closed, or all` };
  }
  try {
    const raw = execGhSync(["api", `${MILESTONES}?state=${state}&per_page=100`, "--paginate", "--slurp"], { cwd: repoRoot });
    const milestones = (JSON.parse(raw) as RawMilestone[][]).flat().map(compactMilestone);
    return { ok: true as const, count: milestones.length, milestones };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Creates a milestone. */
export async function milestoneNew(repoRoot: string, input: MilestoneNewInput) {
  if (!input || !input.title) return { ok: false as const, error: "missing milestone title" };
  if (input.dueOn === NO_DUE_DATE) return { ok: false as const, error: "a new milestone has no due date to clear; omit dueOn" };
  const fields = milestoneFields({ title: input.title, dueOn: input.dueOn });
  if (!fields.ok) return { ok: false as const, error: fields.error };
  try {
    const milestone = writeMilestone(repoRoot, ["api", "--method", "POST", MILESTONES, ...fields.args], input.description);
    return { ok: true as const, milestone };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Renames, re-describes, re-dates, closes, or reopens a milestone. */
export async function milestoneUpdate(repoRoot: string, input: MilestoneUpdateInput) {
  if (!input || !input.number) return { ok: false as const, error: "missing milestone number" };
  const fields = milestoneFields(input);
  if (!fields.ok) return { ok: false as const, error: fields.error };
  if (fields.args.length === 0 && input.description === undefined) {
    return { ok: false as const, error: "nothing to update: pass title, description, dueOn, or state" };
  }
  try {
    const path = `${MILESTONES}/${encodeURIComponent(String(input.number))}`;
    const milestone = writeMilestone(repoRoot, ["api", "--method", "PATCH", path, ...fields.args], input.description);
    return { ok: true as const, milestone };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}
