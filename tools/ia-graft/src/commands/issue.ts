import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execGhSync } from "../git/exec.ts";

/**
 * Hands `text` to `use` as a real temp file, removed afterwards.
 *
 * Long text must reach `gh` as a file, never inline: `execFileSync` still
 * assembles one Windows command line under the hood, and CreateProcess caps
 * that around 32K characters -- comfortably exceeded by a design doc pasted
 * into an issue body (#247 hit this at ~35K, ENAMETOOLONG, past the point
 * where `--body <text>` had worked for a smaller draft of the same issue).
 * `gh` reads files off disk, so routing every long-text value through a temp
 * file sidesteps the OS limit regardless of how large the text is.
 */
export function withTempTextFile<T>(text: string, use: (filePath: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "ia-graft-"));
  const filePath = join(dir, "body.md");
  try {
    writeFileSync(filePath, text, "utf8");
    return use(filePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs a `gh` subcommand whose `flag` takes the path of a file holding `text`. */
function ghWithTextFile(args: readonly string[], flag: string, text: string): string {
  return withTempTextFile(text, (filePath) => execGhSync([...args, flag, filePath]));
}

export interface IssueParentRef {
  id?: string;
  number: number;
  title: string;
  state: string;
  url?: string;
}

export interface IssueSubIssueRef {
  id?: string;
  number: number;
  title: string;
  state: string;
  url?: string;
}

export interface IssueSubIssuesSummary {
  completed: number;
  percentCompleted: number;
  total: number;
}

export interface IssueListInput {
  type?: string;
  area?: string;
  status?: string;
  priority?: string;
  limit?: number;
  parent?: number | string;
  orphan?: boolean;
  milestone?: string;
  state?: IssueListState;
}

export type IssueListState = "open" | "closed" | "all";

const ISSUE_LIST_STATES: readonly string[] = ["open", "closed", "all"];

export interface IssueViewInput {
  id: number | string;
}

export interface IssueNewInput {
  title: string;
  type: "task" | "refinement" | "chore" | "bug" | "epic" | string;
  area?: string;
  priority?: "P0-critical" | "P1-high" | "P2-medium" | "P3-low" | string;
  status?: string;
  milestone?: string;
  body?: string;
  parent?: number | string;
}

export interface IssueUpdateInput {
  id: number | string;
  title?: string;
  type?: string;
  area?: string;
  status?: string;
  priority?: string;
  milestone?: string;
  removeMilestone?: boolean;
  parent?: number | string;
  removeParent?: boolean;
  comment?: string;
  body?: string;
  state?: "open" | "closed";
  reason?: IssueCloseReason;
}

export type IssueCloseReason = "completed" | "not_planned";

export interface CompactIssue {
  id: number;
  title: string;
  type?: string;
  area?: string;
  priority?: string;
  status?: string;
  state?: string;
  milestone?: string;
  url: string;
  parent?: IssueParentRef;
}

export function parseLabels(labels: Array<{ name: string }>): {
  type?: string;
  area?: string;
  priority?: string;
  status?: string;
} {
  const result: { type?: string; area?: string; priority?: string; status?: string } = {};
  for (const label of labels) {
    if (label.name.startsWith("type: ")) result.type = label.name.replace("type: ", "");
    if (label.name.startsWith("area: ")) result.area = label.name.replace("area: ", "");
    if (label.name.startsWith("priority: ")) result.priority = label.name.replace("priority: ", "");
    if (label.name.startsWith("status: ")) result.status = label.name.replace("status: ", "");
  }
  return result;
}

/**
 * Lists issues from GitHub in a token-compact format with hierarchical parent metadata.
 */
export async function issueList(_repoRoot: string, input: IssueListInput = {}) {
  const state = input.state ?? "open";
  if (!ISSUE_LIST_STATES.includes(state)) {
    return { ok: false as const, error: `invalid issue state "${state}": expected open, closed, or all` };
  }
  try {
    const limit = String(input.limit || 50);
    const args = ["issue", "list", "--limit", limit, "--state", state, "--json", "number,title,labels,milestone,url,state,parent"];
    if (input.milestone) args.push("--milestone", input.milestone);
    const raw = execGhSync(args);
    const parsed = JSON.parse(raw) as Array<{
      number: number;
      title: string;
      labels: Array<{ name: string }>;
      milestone?: { title: string };
      url: string;
      state: string;
      parent?: {
        id?: string;
        number: number;
        title: string;
        state: string;
        url?: string;
      } | null;
    }>;

    let issues: CompactIssue[] = parsed.map((item) => {
      const parsedLabels = parseLabels(item.labels);
      return {
        id: item.number,
        title: item.title,
        type: parsedLabels.type,
        area: parsedLabels.area,
        priority: parsedLabels.priority,
        status: parsedLabels.status,
        state: item.state,
        milestone: item.milestone?.title,
        url: item.url,
        parent: item.parent
          ? {
              id: item.parent.id,
              number: item.parent.number,
              title: item.parent.title,
              state: item.parent.state,
              url: item.parent.url,
            }
          : undefined,
      };
    });

    if (input.type) issues = issues.filter((i) => i.type === input.type);
    if (input.area) issues = issues.filter((i) => i.area === input.area);
    if (input.status) issues = issues.filter((i) => i.status === input.status);
    if (input.priority) issues = issues.filter((i) => i.priority === input.priority);
    if (input.parent !== undefined) {
      issues = issues.filter((i) => i.parent && String(i.parent.number) === String(input.parent));
    }
    if (input.orphan) {
      issues = issues.filter((i) => !i.parent && i.type !== "epic");
    }

    return {
      ok: true as const,
      count: issues.length,
      issues,
    };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Views a single issue in detail, including sub-issues, summary, and parent link.
 */
export async function issueView(_repoRoot: string, input: IssueViewInput) {
  if (!input || !input.id) return { ok: false as const, error: "missing issue id" };
  try {
    const raw = execGhSync([
      "issue",
      "view",
      String(input.id),
      "--json",
      "number,title,body,labels,milestone,state,url,comments,parent,subIssues,subIssuesSummary",
    ]);
    const parsed = JSON.parse(raw);
    const parsedLabels = parseLabels(parsed.labels || []);
    return {
      ok: true as const,
      id: parsed.number,
      title: parsed.title,
      type: parsedLabels.type,
      area: parsedLabels.area,
      priority: parsedLabels.priority,
      status: parsedLabels.status,
      milestone: parsed.milestone?.title,
      state: parsed.state,
      body: parsed.body,
      url: parsed.url,
      commentCount: parsed.comments?.length || 0,
      parent: parsed.parent
        ? {
            id: parsed.parent.id,
            number: parsed.parent.number,
            title: parsed.parent.title,
            state: parsed.parent.state,
            url: parsed.parent.url,
          }
        : undefined,
      subIssues: (parsed.subIssues?.nodes as IssueSubIssueRef[] | undefined) || [],
      subIssuesSummary: (parsed.subIssuesSummary as IssueSubIssuesSummary | undefined) || undefined,
    };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Creates a new structured issue on GitHub.
 */
export async function issueNew(_repoRoot: string, input: IssueNewInput) {
  if (!input || !input.title) return { ok: false as const, error: "missing issue title" };
  try {
    const args = ["issue", "create", "--title", input.title];

    // Add type label
    const type = input.type ? (input.type.startsWith("type: ") ? input.type : `type: ${input.type}`) : "type: task";
    args.push("--label", type);

    // Add status label
    const status = input.status ? (input.status.startsWith("status: ") ? input.status : `status: ${input.status}`) : (type === "type: refinement" ? "status: refinement" : "status: backlog");
    args.push("--label", status);

    // Add area label
    if (input.area) {
      const area = input.area.startsWith("area: ") ? input.area : `area: ${input.area}`;
      args.push("--label", area);
    }

    // Add priority label
    if (input.priority) {
      const priority = input.priority.startsWith("priority: ") ? input.priority : `priority: ${input.priority}`;
      args.push("--label", priority);
    }

    // Add milestone
    if (input.milestone) {
      args.push("--milestone", input.milestone);
    }

    // Add parent
    if (input.parent) {
      args.push("--parent", String(input.parent));
    }

    const output = ghWithTextFile(args, "--body-file", input.body || "").trim();
    const match = output.match(/\/issues\/(\d+)$/);
    const id = match ? Number(match[1]) : undefined;

    return {
      ok: true as const,
      id,
      url: output,
    };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Close reasons in GitHub's own snake_case `state_reason` spelling, mapped to
 * the spaced spelling `gh issue close --reason` accepts.
 */
const GH_CLOSE_REASONS: Readonly<Record<IssueCloseReason, string>> = {
  completed: "completed",
  not_planned: "not planned",
};

/** The `gh issue close --reason` value for a close reason, or `undefined` if the reason is unknown. */
export function ghCloseReason(reason: string): string | undefined {
  return Object.hasOwn(GH_CLOSE_REASONS, reason) ? GH_CLOSE_REASONS[reason as IssueCloseReason] : undefined;
}

/** The label families an issue carries exactly one of, each named by its label prefix. */
const SINGLE_VALUE_LABELS = ["type", "area", "status", "priority"] as const;

/** Why `input` asks for two contradictory edits at once, or `undefined` when it does not. */
export function issueUpdateConflict(input: IssueUpdateInput): string | undefined {
  if (input.milestone && input.removeMilestone) return "pass either milestone or removeMilestone, not both";
  if (input.parent !== undefined && input.parent !== "" && input.removeParent) {
    return "pass either parent or removeParent, not both";
  }
  return undefined;
}

/**
 * The `gh issue edit` argv for every metadata change in `input`, or
 * `undefined` when there is none.
 *
 * A single-value label (`type`, `area`, `status`, `priority`) is swapped, not
 * added: every other label of the same family in `currentLabels` is removed,
 * so an issue never ends up both `P1-high` and `P3-low`.
 */
export function planIssueEdit(
  id: string,
  input: IssueUpdateInput,
  currentLabels: readonly string[],
): string[] | undefined {
  const args = ["issue", "edit", id];
  for (const family of SINGLE_VALUE_LABELS) {
    const value = input[family];
    if (!value) continue;
    const next = value.startsWith(`${family}: `) ? value : `${family}: ${value}`;
    for (const label of currentLabels) {
      if (label.startsWith(`${family}: `) && label !== next) args.push("--remove-label", label);
    }
    args.push("--add-label", next);
  }
  if (input.title) args.push("--title", input.title);
  if (input.milestone) args.push("--milestone", input.milestone);
  if (input.removeMilestone) args.push("--remove-milestone");
  if (input.parent !== undefined && input.parent !== "") args.push("--parent", String(input.parent));
  if (input.removeParent) args.push("--remove-parent");
  return args.length > 3 ? args : undefined;
}

/**
 * Updates an existing issue: title, single-value labels, milestone, parent,
 * body, a comment, and its open/closed state.
 */
export async function issueUpdate(_repoRoot: string, input: IssueUpdateInput) {
  if (!input || !input.id) return { ok: false as const, error: "missing issue id" };
  const closeReason = input.reason ? ghCloseReason(input.reason) : undefined;
  if (input.reason && closeReason === undefined) {
    return { ok: false as const, error: `invalid close reason "${input.reason}": expected completed or not_planned` };
  }
  const conflict = issueUpdateConflict(input);
  if (conflict) return { ok: false as const, error: conflict };
  try {
    const id = String(input.id);

    if (input.comment) {
      ghWithTextFile(["issue", "comment", id], "--body-file", input.comment);
    }

    if (input.body !== undefined) {
      ghWithTextFile(["issue", "edit", id], "--body-file", input.body);
    }

    const needsLabels = SINGLE_VALUE_LABELS.some((family) => input[family]);
    const currentLabels = needsLabels
      ? (JSON.parse(execGhSync(["issue", "view", id, "--json", "labels"])).labels as Array<{ name: string }>).map((l) => l.name)
      : [];
    const editArgs = planIssueEdit(id, input, currentLabels);
    if (editArgs) execGhSync(editArgs);

    if (input.state === "closed") {
      const closeArgs = ["issue", "close", id];
      if (closeReason) closeArgs.push("--reason", closeReason);
      execGhSync(closeArgs);
    } else if (input.state === "open") {
      execGhSync(["issue", "reopen", id]);
    }

    return { ok: true as const, id: Number(id), state: input.state };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface IssueCloseInput {
  id: number | string;
  reason?: IssueCloseReason;
  comment?: string;
}

export interface IssueReopenInput {
  id: number | string;
  comment?: string;
}

export async function issueClose(repoRoot: string, input: IssueCloseInput) {
  return issueUpdate(repoRoot, { id: input.id, state: "closed", reason: input.reason, comment: input.comment });
}

export async function issueReopen(repoRoot: string, input: IssueReopenInput) {
  return issueUpdate(repoRoot, { id: input.id, state: "open", comment: input.comment });
}

export interface IssueTreeInput {
  epic?: number | string;
  limit?: number;
}

export interface IssueTreeNode {
  id: number;
  title: string;
  type?: string;
  area?: string;
  priority?: string;
  status?: string;
  state: string;
  milestone?: string;
  subIssuesCount?: number;
  children: IssueTreeNode[];
}

/**
 * Returns a structured hierarchical tree of epics, parent-child links, and orphan issues.
 */
export async function issueTree(repoRoot: string, input: IssueTreeInput = {}) {
  try {
    const listRes = await issueList(repoRoot, { limit: input.limit || 100 });
    if (!listRes.ok) return listRes;

    const allIssues = listRes.issues;
    const nodeMap = new Map<number, IssueTreeNode>();

    for (const issue of allIssues) {
      nodeMap.set(issue.id, {
        id: issue.id,
        title: issue.title,
        type: issue.type,
        area: issue.area,
        priority: issue.priority,
        status: issue.status,
        state: issue.state || "OPEN",
        milestone: issue.milestone,
        children: [],
      });
    }

    const epics: IssueTreeNode[] = [];
    const orphans: IssueTreeNode[] = [];

    for (const issue of allIssues) {
      const node = nodeMap.get(issue.id)!;
      if (issue.parent && nodeMap.has(issue.parent.number)) {
        const parentNode = nodeMap.get(issue.parent.number)!;
        parentNode.children.push(node);
      } else if (issue.type === "epic") {
        epics.push(node);
      } else if (!issue.parent) {
        orphans.push(node);
      }
    }

    for (const epic of epics) {
      epic.subIssuesCount = epic.children.length;
    }

    if (input.epic !== undefined) {
      const targetEpicId = Number(input.epic);
      const matched = epics.find((e) => e.id === targetEpicId) || nodeMap.get(targetEpicId);
      if (!matched) {
        return { ok: false as const, error: `epic #${input.epic} not found in recent issues` };
      }
      return {
        ok: true as const,
        tree: [matched],
        orphansCount: 0,
        orphans: [],
      };
    }

    return {
      ok: true as const,
      epicsCount: epics.length,
      orphansCount: orphans.length,
      tree: epics,
      orphans,
    };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface IssueDoctorInput {
  limit?: number;
}

export interface IssueDiagnostic {
  issueId: number;
  title: string;
  severity: "error" | "warning";
  code:
    | "ORPHAN_TASK"
    | "MISSING_AREA"
    | "MISSING_PRIORITY"
    | "MISSING_MILESTONE"
    | "MILESTONE_MISMATCH"
    | "PARENT_CLOSED";
  message: string;
}

/**
 * Audits open issues for broken links, missing metadata, and loose ends.
 */
export async function issueDoctor(repoRoot: string, input: IssueDoctorInput = {}) {
  try {
    const listRes = await issueList(repoRoot, { limit: input.limit || 100 });
    if (!listRes.ok) return listRes;

    const issues = listRes.issues;
    const issueById = new Map<number, CompactIssue>(issues.map((i) => [i.id, i]));
    const diagnostics: IssueDiagnostic[] = [];

    for (const issue of issues) {
      // Check 1: Tasks/Bugs without parent epic
      if (!issue.parent && (issue.type === "task" || issue.type === "bug")) {
        diagnostics.push({
          issueId: issue.id,
          title: issue.title,
          severity: "warning",
          code: "ORPHAN_TASK",
          message: `Issue #${issue.id} (${issue.type}) has no parent Epic assigned.`,
        });
      }

      // Check 2: Missing area label
      if (!issue.area) {
        diagnostics.push({
          issueId: issue.id,
          title: issue.title,
          severity: "warning",
          code: "MISSING_AREA",
          message: `Issue #${issue.id} is missing an 'area:' label.`,
        });
      }

      // Check 3: Missing priority label
      if (!issue.priority) {
        diagnostics.push({
          issueId: issue.id,
          title: issue.title,
          severity: "warning",
          code: "MISSING_PRIORITY",
          message: `Issue #${issue.id} is missing a 'priority:' label.`,
        });
      }

      // Check 4: Missing milestone
      if (!issue.milestone) {
        diagnostics.push({
          issueId: issue.id,
          title: issue.title,
          severity: "warning",
          code: "MISSING_MILESTONE",
          message: `Issue #${issue.id} is not assigned to any milestone.`,
        });
      }

      // Check 5: Milestone mismatch between child and parent
      if (issue.parent) {
        const parentIssue = issueById.get(issue.parent.number);
        if (parentIssue && parentIssue.milestone && issue.milestone && parentIssue.milestone !== issue.milestone) {
          diagnostics.push({
            issueId: issue.id,
            title: issue.title,
            severity: "warning",
            code: "MILESTONE_MISMATCH",
            message: `Issue #${issue.id} milestone ('${issue.milestone}') does not match parent Epic #${parentIssue.id} ('${parentIssue.milestone}').`,
          });
        }
        if (parentIssue && parentIssue.state === "CLOSED" && issue.state !== "CLOSED") {
          diagnostics.push({
            issueId: issue.id,
            title: issue.title,
            severity: "error",
            code: "PARENT_CLOSED",
            message: `Issue #${issue.id} is OPEN but parent Epic #${parentIssue.id} is CLOSED.`,
          });
        }
      }
    }

    const errorCount = diagnostics.filter((d) => d.severity === "error").length;
    const warningCount = diagnostics.filter((d) => d.severity === "warning").length;

    return {
      ok: true as const,
      passed: errorCount === 0,
      totalIssuesAudited: issues.length,
      errorCount,
      warningCount,
      diagnostics,
    };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}
