import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Runs a `gh` subcommand whose body/comment text must reach it as a file,
 * never inline: `execFileSync` still assembles one Windows command line
 * under the hood, and CreateProcess caps that around 32K characters --
 * comfortably exceeded by a design doc pasted into an issue body (#247 hit
 * this at ~35K, ENAMETOOLONG, past the point where `--body <text>` had
 * worked for a smaller draft of the same issue). `gh` itself reads
 * `--body-file` off disk, so routing every long-text flag through a real
 * temp file sidesteps the OS limit regardless of how large the text is.
 */
function ghWithTextFile(args: readonly string[], flag: string, text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ia-graft-"));
  const filePath = join(dir, "body.md");
  try {
    writeFileSync(filePath, text, "utf8");
    return execFileSync("gh", [...args, flag, filePath], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
}

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
  status?: string;
  priority?: string;
  comment?: string;
  body?: string;
  state?: "open" | "closed";
  reason?: "completed" | "not_planned";
}

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
  try {
    const limit = String(input.limit || 50);
    const raw = execFileSync(
      "gh",
      [
        "issue",
        "list",
        "--limit",
        limit,
        "--json",
        "number,title,labels,milestone,url,state,parent",
      ],
      { encoding: "utf8" },
    );
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
    const raw = execFileSync(
      "gh",
      [
        "issue",
        "view",
        String(input.id),
        "--json",
        "number,title,body,labels,milestone,state,url,comments,parent,subIssues,subIssuesSummary",
      ],
      { encoding: "utf8" },
    );
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
 * Updates an existing issue (status/priority label swap, comment, body).
 */
export async function issueUpdate(_repoRoot: string, input: IssueUpdateInput) {
  if (!input || !input.id) return { ok: false as const, error: "missing issue id" };
  try {
    const id = String(input.id);

    // Add comment if provided
    if (input.comment) {
      ghWithTextFile(["issue", "comment", id], "--body-file", input.comment);
    }

    // Replace the body outright if provided
    if (input.body !== undefined) {
      ghWithTextFile(["issue", "edit", id], "--body-file", input.body);
    }

    // Update status or priority if provided
    if (input.status || input.priority) {
      const viewRaw = execFileSync("gh", ["issue", "view", id, "--json", "labels"], { encoding: "utf8" });
      const current = JSON.parse(viewRaw).labels as Array<{ name: string }>;
      
      const removeLabels: string[] = [];
      const addLabels: string[] = [];

      if (input.status) {
        const newStatus = input.status.startsWith("status: ") ? input.status : `status: ${input.status}`;
        for (const l of current) {
          if (l.name.startsWith("status: ") && l.name !== newStatus) removeLabels.push(l.name);
        }
        addLabels.push(newStatus);
      }

      if (input.priority) {
        const newPriority = input.priority.startsWith("priority: ") ? input.priority : `priority: ${input.priority}`;
        for (const l of current) {
          if (l.name.startsWith("priority: ") && l.name !== newPriority) removeLabels.push(l.name);
        }
        addLabels.push(newPriority);
      }

      const editArgs = ["issue", "edit", id];
      for (const l of removeLabels) editArgs.push("--remove-label", l);
      for (const l of addLabels) editArgs.push("--add-label", l);

      if (editArgs.length > 3) {
        execFileSync("gh", editArgs, { encoding: "utf8" });
      }
    }

    if (input.state === "closed") {
      const closeArgs = ["issue", "close", id];
      if (input.reason) closeArgs.push("--reason", input.reason);
      execFileSync("gh", closeArgs, { encoding: "utf8" });
    } else if (input.state === "open") {
      execFileSync("gh", ["issue", "reopen", id], { encoding: "utf8" });
    }

    return { ok: true as const, id: Number(id), state: input.state };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface IssueCloseInput {
  id: number | string;
  reason?: "completed" | "not_planned";
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
