import { execFileSync } from "node:child_process";

export interface PrListInput {
  limit?: number;
  state?: "open" | "closed" | "all";
}

export interface PrViewInput {
  id?: number | string;
  task?: string;
}

export interface PrChecksInput {
  id?: number | string;
  task?: string;
  failedOnly?: boolean;
}

export interface PrDiffInput {
  id?: number | string;
  task?: string;
  stat?: boolean;
}

function resolvePrTarget(input: { id?: number | string; task?: string }): string {
  if (input.id !== undefined) return String(input.id);
  if (input.task) {
    return input.task.startsWith("task/") ? input.task : `task/${input.task}`;
  }
  return "";
}

/**
 * Lists Pull Requests in a token-compact format.
 */
export async function prList(_repoRoot: string, input: PrListInput = {}) {
  try {
    const args = ["pr", "list", "--json", "number,title,headRefName,baseRefName,state,url,isDraft"];
    if (input.limit) args.push("--limit", String(input.limit));
    if (input.state) args.push("--state", input.state);

    const raw = execFileSync("gh", args, { encoding: "utf8" });
    const prs = JSON.parse(raw) as Array<{
      number: number;
      title: string;
      headRefName: string;
      baseRefName: string;
      state: string;
      url: string;
      isDraft: boolean;
    }>;

    return {
      ok: true as const,
      prs: prs.map((p) => ({
        number: p.number,
        title: p.title,
        branch: p.headRefName,
        base: p.baseRefName,
        state: p.state,
        url: p.url,
        isDraft: p.isDraft,
      })),
    };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Views a Pull Request in a token-compact format with checks rollup and capped body summary.
 */
export async function prView(_repoRoot: string, input: PrViewInput = {}) {
  try {
    const target = resolvePrTarget(input);
    const args = ["pr", "view"];
    if (target) args.push(target);
    args.push("--json", "number,title,state,headRefName,baseRefName,url,isDraft,mergeable,statusCheckRollup,body");

    const raw = execFileSync("gh", args, { encoding: "utf8" });
    const pr = JSON.parse(raw) as {
      number: number;
      title: string;
      state: string;
      headRefName: string;
      baseRefName: string;
      url: string;
      isDraft: boolean;
      mergeable: string;
      body: string;
      statusCheckRollup?: Array<{
        name?: string;
        state?: string;
        status?: string;
        conclusion?: string;
      }>;
    };

    let checkSummary: { total: number; passing: number; pending: number; failing: number } | undefined;
    if (pr.statusCheckRollup && Array.isArray(pr.statusCheckRollup)) {
      let passing = 0;
      let pending = 0;
      let failing = 0;
      for (const c of pr.statusCheckRollup) {
        const conclusion = (c.conclusion ?? c.state ?? "").toLowerCase();
        if (conclusion === "success" || conclusion === "neutral") passing += 1;
        else if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "action_required") failing += 1;
        else pending += 1;
      }
      checkSummary = { total: pr.statusCheckRollup.length, passing, pending, failing };
    }

    return {
      ok: true as const,
      number: pr.number,
      title: pr.title,
      state: pr.state,
      head: pr.headRefName,
      base: pr.baseRefName,
      url: pr.url,
      mergeable: pr.mergeable,
      isDraft: pr.isDraft,
      checkSummary,
      body: pr.body.length > 2000 ? pr.body.slice(0, 2000) + "\n... (truncated for context economy)" : pr.body,
    };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Inspects CI checks for a Pull Request, diagnosing and summarizing failure logs concisely.
 */
export async function prChecks(_repoRoot: string, input: PrChecksInput = {}) {
  try {
    const target = resolvePrTarget(input);
    const args = ["pr", "checks"];
    if (target) args.push(target);
    args.push("--json", "bucket,name,state,workflow,link");

    const raw = execFileSync("gh", args, { encoding: "utf8" });
    const checks = JSON.parse(raw) as Array<{
      bucket: string;
      name: string;
      state: string;
      workflow: string;
      link: string;
    }>;

    let passing = 0;
    let pending = 0;
    let failing = 0;
    const failedChecks: Array<{ name: string; workflow: string; link: string; errorSummary?: string }> = [];

    for (const check of checks) {
      if (check.bucket === "pass") {
        passing += 1;
      } else if (check.bucket === "fail") {
        failing += 1;
        let errorSummary: string | undefined;
        const runMatch = check.link.match(/actions\/runs\/(\d+)/);
        if (runMatch && runMatch[1]) {
          try {
            const runLog = execFileSync("gh", ["run", "view", runMatch[1], "--log-failed"], {
              encoding: "utf8",
              timeout: 15000,
            });
            const lines = runLog.trim().split(/\r?\n/);
            const tail = lines.slice(-25).join("\n").trim();
            if (tail) errorSummary = tail;
          } catch {
            // Log inspection failure is non-fatal
          }
        }
        failedChecks.push({
          name: check.name,
          workflow: check.workflow,
          link: check.link,
          errorSummary,
        });
      } else {
        pending += 1;
      }
    }

    const filtered = input.failedOnly ? failedChecks : checks;

    return {
      ok: true as const,
      totalChecks: checks.length,
      passing,
      pending,
      failing,
      checks: filtered,
      failedChecks,
    };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Returns a compact list of files changed or diff stat in a Pull Request.
 */
export async function prDiff(_repoRoot: string, input: PrDiffInput = {}) {
  try {
    const target = resolvePrTarget(input);
    const args = ["pr", "diff"];
    if (target) args.push(target);
    args.push(input.stat ? "--stat" : "--name-only");

    const raw = execFileSync("gh", args, { encoding: "utf8" });
    if (input.stat) {
      return { ok: true as const, target: target || undefined, stat: raw.trim() };
    }
    const files = raw.trim().split(/\r?\n/).map((f) => f.trim()).filter(Boolean);
    return {
      ok: true as const,
      target: target || undefined,
      totalFiles: files.length,
      files,
    };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}
