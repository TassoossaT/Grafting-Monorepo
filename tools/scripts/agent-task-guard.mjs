import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

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

const HARNESS_MEMORY_PATH = /(?:^|[\\/])\.claude[\\/]projects[\\/][^\\/]+[\\/]memory(?:[\\/]|$)/i;
const HARNESS_PLANS_PATH = /(?:^|[\\/])\.claude[\\/]plans(?:[\\/]|$)/i;

/**
 * The Claude Code harness's own cross-session memory directory and
 * plan-mode plan-file directory are deliberately outside any repository --
 * memory persists across projects, and a plan file exists before any task
 * even starts. Matched by path segment, not a hardcoded absolute prefix, so
 * this does not depend on one specific user home directory.
 */
export function isHarnessManagedPath(candidate) {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  return HARNESS_MEMORY_PATH.test(candidate) || HARNESS_PLANS_PATH.test(candidate);
}

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
  return /^(?:pwd\b|ls\b|cat\b|rg\b|grep\b|Get-Content\b|Get-ChildItem\b|Select-String\b|git\s+(?:status|diff|log|show|rev-parse|ls-files|worktree)\b)/i.test(
    value,
  );
}

const gitSubcommandPattern = (subcommands) =>
  new RegExp(
    `\\bgit(?:\\.exe)?\\s+(?:(?:-C|-c|--git-dir|--work-tree)\\s+\\S+\\s+)*(?:${subcommands.join("|")})\\b`,
    "i",
  );

/**
 * Coordination is handled by tools/ia-graft (worktree per task, PR via `gh`).
 * This guard does not reproduce task ownership or file scope; it enforces the
 * outer Git boundary everywhere. Agents may commit on their task branch and
 * may invoke `ia-graft task sync`, whose internal forward merge is constrained
 * to the recorded base. Raw merge/history rewriting, default-branch pushes,
 * force operations and agent-side PR merge remain denied.
 */
export function evaluateAgentGitCommand(command) {
  if (typeof command !== "string" || command.trim().length === 0) return allowed();

  const packageInstall = /\b(?:pnpm|npm|yarn|bun|uv|pip)\s+(?:install|add|i)\b/i;
  if (packageInstall.test(command)) {
    return denied(
      "direct package-manager installation is forbidden; use 'ia-graft task deps --install' instead to prevent lockfile drift and context noise",
    );
  }

  const historyRewriting = gitSubcommandPattern([
    "commit-tree",
    "merge",
    "rebase",
    "cherry-pick",
    "revert",
    "am",
    "notes",
    "fast-import",
    "filter-branch",
  ]);
  if (historyRewriting.test(command)) {
    return denied(
      "raw Git merge/history rewriting is forbidden; use ia-graft task sync only for the task's recorded base",
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
    if (target === null) {
      if (isHarnessManagedPath(candidate)) return allowed();
      return denied(`tool target is outside the repository: ${candidate ?? "missing"}`);
    }
    return allowed();
  }

  if (tool === "Bash") {
    return evaluateAgentGitCommand(hookInput.tool_input?.command);
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
