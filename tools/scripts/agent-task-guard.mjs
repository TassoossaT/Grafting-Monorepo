import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, isAbsolute, posix, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const TASK_RECORD = /^\.ai\/state\/tasks\/([A-Z][A-Z0-9-]{2,63})\.json$/;
const HANDOFF_RECORD = /^\.ai\/state\/handoffs\/.+\.json$/;

const allowed = () => ({ allowed: true, reason: "" });
const denied = (reason) => ({ allowed: false, reason });

export function normalizeRepositoryPath(root, candidate) {
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  const rootPath = resolve(root);
  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(rootPath, candidate);
  const repositoryRelative = relative(rootPath, absolute);
  if (
    repositoryRelative === ".." ||
    repositoryRelative.startsWith(`..${sep}`) ||
    isAbsolute(repositoryRelative)
  ) {
    return null;
  }
  return repositoryRelative.replaceAll("\\", "/");
}

export function affectedPathMatches(affectedPath, repositoryRelativePath) {
  if (typeof affectedPath !== "string" || affectedPath.length === 0) return false;
  const portable = affectedPath.replaceAll("\\", "/");
  if (portable === "." || portable.startsWith("/") || portable.startsWith("../")) return false;
  const isDirectory = portable.endsWith("/");
  const normalized = posix.normalize(portable).replace(/^\.\//, "").replace(/\/$/, "");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) return false;
  return (
    repositoryRelativePath === normalized ||
    (isDirectory && repositoryRelativePath.startsWith(`${normalized}/`))
  );
}

const loadTasks = async (root) => {
  const taskDirectory = resolve(root, ".ai/state/tasks");
  const names = (await readdir(taskDirectory)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(
    names.map(async (name) => {
      const path = resolve(taskDirectory, name);
      try {
        return JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`cannot evaluate task ownership because ${name} is invalid: ${reason}`);
      }
    }),
  );
};

const activeTaskFor = (tasks, agent) => {
  const owned = tasks.filter((task) => task.status === "in_progress" && task.owner === agent);
  if (owned.length === 0) {
    return denied(
      `no in_progress task is owned by ${agent}; create a planned record under .ai/state/tasks, re-read it, and claim it before using mutating tools`,
    );
  }
  if (owned.length > 1) {
    return denied(
      `${agent} owns more than one in_progress task (${owned.map((task) => task.task_id).join(", ")}); resolve ownership before continuing`,
    );
  }
  return { allowed: true, reason: "", task: owned[0] };
};

const evaluateTaskRecordWrite = (root, path, agent) => {
  const match = TASK_RECORD.exec(path);
  if (!match) return denied(`invalid task record path: ${path}`);
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) return allowed();

  let task;
  try {
    task = JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    return allowed();
  }
  if (["completed", "cancelled"].includes(task.status)) {
    return denied(`task ${task.task_id ?? match[1]} is ${task.status} and cannot be reused for new work`);
  }
  if (task.owner && task.owner !== agent) {
    return denied(`task ${task.task_id ?? match[1]} belongs to ${task.owner}, not ${agent}`);
  }
  return allowed();
};

const targetPathFrom = (hookInput) => {
  if (!hookInput || typeof hookInput !== "object") return null;
  const toolInput = hookInput.tool_input;
  if (!toolInput || typeof toolInput !== "object") return null;
  return toolInput.file_path ?? null;
};

export function isReadOnlyInspectionCommand(command) {
  if (typeof command !== "string" || command.trim().length === 0) return false;
  const value = command.trim();
  if (/(?:[;&|><`]|\$\(|\r|\n)/.test(value)) return false;
  if (/^rg\b/i.test(value) && /(?:^|\s)--pre(?:\s|=|$)/i.test(value)) return false;
  return /^(?:pwd\b|ls\b|cat\b|rg\b|grep\b|Get-Content\b|Get-ChildItem\b|Select-String\b|git\s+(?:status|diff|log|show|rev-parse|ls-files)\b)/i.test(
    value,
  );
}

const gitSubcommandPattern = (subcommands) =>
  new RegExp(
    `\\bgit(?:\\.exe)?\\s+(?:(?:-C|-c|--git-dir|--work-tree)\\s+\\S+\\s+)*(?:${subcommands.join("|")})\\b`,
    "i",
  );

/** Enforces owner-approved Git history rules before ordinary task ownership. */
export function evaluateAgentGitCommand(command) {
  if (typeof command !== "string" || command.trim().length === 0) return allowed();

  const commitProducing = gitSubcommandPattern([
    "commit",
    "commit-tree",
    "merge",
    "rebase",
    "cherry-pick",
    "revert",
    "am",
    "stash",
    "notes",
    "fast-import",
    "filter-branch",
  ]);
  if (commitProducing.test(command)) {
    return denied(
      "AI agents must not create or rewrite Git commits; prepare an uncommitted change for the repository owner",
    );
  }

  if (/\bgh\s+pr\s+merge\b/i.test(command)) {
    return denied("AI agents may prepare or open a pull request but must not merge it");
  }

  const pullSegments = command.match(/\bgit(?:\.exe)?\s+pull\b[^;&|\r\n]*/gi) ?? [];
  for (const segment of pullSegments) {
    if (!/(?:^|\s)--ff-only(?:\s|$)/i.test(segment)) {
      return denied("AI agents may run git pull only with --ff-only so it cannot create a merge commit");
    }
  }

  const pushSegments = command.match(/\bgit(?:\.exe)?\s+push\b[^;&|\r\n]*/gi) ?? [];
  for (const segment of pushSegments) {
    if (/(?:^|\s)(?:-f|--force(?:-with-lease)?|--mirror|--all|--tags|--delete)(?:\s|$)/i.test(segment)) {
      return denied("AI agents must not force, mirror, bulk, tag, or delete remote Git refs");
    }
    if (/(?:^|[\s:])(?:refs\/heads\/)?(?:main|master)(?=$|\s)/i.test(segment)) {
      return denied("AI agents must never push to main or master");
    }
    if (
      !/(?:^|\s)(?:[^\s:]+:)?(?:refs\/heads\/)?ai\/[a-z0-9._/-]+(?=$|\s)/i.test(segment)
    ) {
      return denied(
        "AI agents may push only an explicit isolated ai/<agent>/<task> branch containing human-authored commits",
      );
    }
  }

  return allowed();
}

export async function evaluateHook({ root, agent, hookInput }) {
  if (typeof agent !== "string" || agent.length === 0) return denied("agent ID is required");
  if (!hookInput || hookInput.hook_event_name !== "PreToolUse") {
    return denied("the task guard only accepts PreToolUse input");
  }

  const tool = hookInput.tool_name;
  if (tool === "Write" || tool === "Edit") {
    const candidate = targetPathFrom(hookInput);
    const target = normalizeRepositoryPath(root, candidate);
    if (target === null) return denied(`tool target is outside the repository: ${candidate ?? "missing"}`);

    if (TASK_RECORD.test(target)) return evaluateTaskRecordWrite(root, target, agent);

    const tasks = await loadTasks(root);
    const active = activeTaskFor(tasks, agent);
    if (!active.allowed) return active;

    if (HANDOFF_RECORD.test(target)) {
      if (tool !== "Write") return denied("handoff records are immutable and cannot be edited");
      if (existsSync(resolve(root, target))) return denied("handoff records are immutable and cannot be overwritten");
      if (!basename(target).includes(`--${agent}-to-`)) {
        return denied(`new handoff filename must identify ${agent} as the sender`);
      }
      return allowed();
    }

    const conflicting = tasks.find(
      (task) =>
        task.status === "in_progress" &&
        task.owner !== agent &&
        (task.affected_paths ?? []).some((path) => affectedPathMatches(path, target)),
    );
    if (conflicting) {
      return denied(`path ${target} is owned by active task ${conflicting.task_id} (${conflicting.owner})`);
    }

    if (!(active.task.affected_paths ?? []).some((path) => affectedPathMatches(path, target))) {
      return denied(
        `path ${target} is outside active task ${active.task.task_id}; update the task scope through the coordination protocol before editing`,
      );
    }
    return allowed();
  }

  if (tool === "Bash") {
    const command = hookInput.tool_input?.command;
    const gitDecision = evaluateAgentGitCommand(command);
    if (!gitDecision.allowed) return gitDecision;
    const active = activeTaskFor(await loadTasks(root), agent);
    if (active.allowed) return allowed();
    return isReadOnlyInspectionCommand(command) ? allowed() : active;
  }

  return denied(`unsupported mutating tool: ${tool ?? "missing"}`);
}

const parseArguments = (arguments_) => {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("expected --root and --agent");
    values[key.slice(2)] = value;
  }
  return values;
};

const readStandardInput = async () => {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return JSON.parse(input);
};

export async function main(arguments_ = process.argv.slice(2)) {
  try {
    const options = parseArguments(arguments_);
    if (!options.root || !options.agent) throw new Error("usage: --root <path> --agent <agent-id>");
    const decision = await evaluateHook({
      root: options.root,
      agent: options.agent,
      hookInput: await readStandardInput(),
    });
    if (!decision.allowed) {
      console.error(`Grafting coordination guard: ${decision.reason}`);
      return 2;
    }
    return 0;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Grafting coordination guard: ${reason}`);
    return 2;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main();
}
