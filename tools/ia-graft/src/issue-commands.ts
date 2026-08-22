import { execFileSync } from "node:child_process";

export interface IssueListInput {
  type?: string;
  area?: string;
  status?: string;
  priority?: string;
  limit?: number;
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
}

export interface CompactIssue {
  id: number;
  title: string;
  type?: string;
  area?: string;
  priority?: string;
  status?: string;
  milestone?: string;
  url: string;
}

function parseLabels(labels: Array<{ name: string }>): {
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
 * Lists issues from GitHub in a token-compact format.
 */
export async function issueList(_repoRoot: string, input: IssueListInput = {}) {
  try {
    const limit = String(input.limit || 30);
    const raw = execFileSync(
      "gh",
      [
        "issue",
        "list",
        "--limit",
        limit,
        "--json",
        "number,title,labels,milestone,url,state",
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
        milestone: item.milestone?.title,
        url: item.url,
      };
    });

    if (input.type) issues = issues.filter((i) => i.type === input.type);
    if (input.area) issues = issues.filter((i) => i.area === input.area);
    if (input.status) issues = issues.filter((i) => i.status === input.status);
    if (input.priority) issues = issues.filter((i) => i.priority === input.priority);

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
 * Views a single issue in detail.
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
        "number,title,body,labels,milestone,state,url,comments",
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
    const args = ["issue", "create", "--title", input.title, "--body", input.body || ""];
    
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

    const output = execFileSync("gh", args, { encoding: "utf8" }).trim();
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
 * Updates an existing issue (status/priority label swap, comment).
 */
export async function issueUpdate(_repoRoot: string, input: IssueUpdateInput) {
  if (!input || !input.id) return { ok: false as const, error: "missing issue id" };
  try {
    const id = String(input.id);

    // Add comment if provided
    if (input.comment) {
      execFileSync("gh", ["issue", "comment", id, "--body", input.comment], { encoding: "utf8" });
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

    return { ok: true as const, id: Number(id) };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}
