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

/**
 * Blanks out single- and double-quoted spans so a rule only ever matches a
 * command the shell would actually run.
 *
 * Every rule below is a substring match over the whole command line, so a
 * phrase merely *mentioned* inside an argument was denied as though it were
 * being executed: an `echo` explaining the policy, or an `ia-graft task
 * commit` whose message quotes the very command it replaces. The quotes are
 * overwritten rather than removed so offsets, and with them the word
 * boundaries around each span, survive.
 */
export function withoutQuotedSpans(command) {
  return command.replace(/'[^']*'|"[^"]*"/g, (span) => span[0].repeat(span.length));
}

const gitSubcommandPattern = (subcommands) =>
  new RegExp(
    `\\bgit(?:\\.exe)?\\s+(?:(?:-C|-c|--git-dir|--work-tree)\\s+\\S+\\s+)*(?:${subcommands.join("|")})\\b`,
    "i",
  );

/**
 * Agents that reach ia-graft through the registered MCP server, and therefore
 * must not reach it over Bash.
 *
 * One path, one schema: the MCP manifest is generated from the command
 * registry, so a tool call is validated against the same declarations the CLI
 * parses, while a hand-typed command line is validated against nothing until
 * it fails. Add an agent here only once it actually has the ia-graft MCP
 * server registered -- Codex drives the launcher through
 * `.codex/rules/ia-graft.rules` and would simply lose access (#260).
 */
export const MCP_ONLY_AGENTS = new Set(["claude"]);

const IA_GRAFT_LAUNCHER = /^(?:\.\\|\.\/)?ia-graft(?:\.cmd)?\b/i;
const IA_GRAFT_DIRECT_BIN = /\bnode\s+(?:\S+[\\/])?tools[\\/]ia-graft[\\/]src[\\/]bin\.ts\b/i;

/** The MCP tool an ia-graft command line corresponds to, named in the deny message. */
const mcpToolFor = (command) => {
  const route = command
    .trim()
    .replace(IA_GRAFT_LAUNCHER, "")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0 && !word.startsWith("-"))
    .slice(0, 2);
  return route.length > 0 ? `mcp__ia-graft__graft_${route.join("_").replaceAll("-", "_")}` : "the ia-graft MCP server";
};

/**
 * Coordination is handled by tools/ia-graft (worktree per task, PR via `gh`).
 * This guard does not reproduce task ownership or file scope; it enforces the
 * outer Git boundary everywhere. Agents may commit on their task branch and
 * may invoke `ia-graft task sync`, whose internal forward merge is constrained
 * to the recorded base. Raw merge/history rewriting, default-branch pushes,
 * force operations and agent-side PR merge remain denied.
 */
export function evaluateAgentGitCommand(command, agent) {
  if (typeof command !== "string" || command.trim().length === 0) return allowed();
  const bare = withoutQuotedSpans(command);

  if (IA_GRAFT_LAUNCHER.test(command.trim()) || IA_GRAFT_DIRECT_BIN.test(bare)) {
    if (!MCP_ONLY_AGENTS.has(agent)) return allowed();
    return denied(
      `ia-graft over Bash is disabled for ${agent}; call it through the registered ia-graft MCP server instead, e.g. ${mcpToolFor(command)}. The MCP manifest is generated from the same command registry the CLI parses, so a tool call is checked against the declared schema and a hand-typed command line is not.`,
    );
  }

  const packageInstall = /\b(?:pnpm|npm|yarn|bun|uv|pip)\s+(?:install|add|i)\b/i;
  if (packageInstall.test(bare)) {
    return denied(
      "direct package-manager installation is forbidden; use 'ia-graft task deps --install' or 'ia-graft task deps --add' instead to prevent lockfile drift and context noise",
    );
  }

  const directCommit = gitSubcommandPattern(["commit"]);
  if (directCommit.test(bare)) {
    return denied(
      "direct 'git commit' is forbidden; use 'ia-graft task commit --id <TASK-ID> --message \"...\"' to ensure managed worktree tracking and AI attribution",
    );
  }

  const directAdd = gitSubcommandPattern(["add"]);
  if (directAdd.test(bare)) {
    return denied(
      "direct 'git add' is forbidden; 'ia-graft task commit' automatically stages and tracks changes inside the task worktree",
    );
  }

  const directCheckoutOrBranch = gitSubcommandPattern(["checkout", "switch", "branch"]);
  if (directCheckoutOrBranch.test(bare)) {
    return denied(
      "direct 'git checkout/switch/branch' is forbidden; use 'ia-graft task new --id <TASK-ID> [--parent <PARENT-ID>]' to manage tasks or 'ia-graft task checkout' to test in main",
    );
  }

  const directResetOrStash = gitSubcommandPattern(["reset", "clean", "stash"]);
  if (directResetOrStash.test(bare)) {
    return denied(
      "direct raw git state mutation ('git reset/clean/stash') is forbidden; work exclusively inside the isolated task worktree via ia-graft",
    );
  }

  const directPush = gitSubcommandPattern(["push"]);
  if (directPush.test(bare)) {
    return denied(
      "direct 'git push' is forbidden; use 'ia-graft task done --id <TASK-ID> --title \"...\" --body \"...\"' to push and open/update the PR",
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
  if (historyRewriting.test(bare)) {
    return denied(
      "raw Git merge/history rewriting is forbidden; use 'ia-graft task sync' only for the task's recorded base",
    );
  }

  if (/\bgh(?:\.exe)?\s+pr\s+merge\b/i.test(command)) {
    return denied("AI agents may prepare or open a pull request via 'ia-graft task done' but must not merge it (human merges only)");
  }

  const rawGh = /\bgh(?:\.exe)?\s+(?:issue|pr|repo|api|workflow|run)\b/i;
  if (rawGh.test(bare)) {
    return denied(
      "direct raw 'gh' commands are forbidden for AI agents; use 'ia-graft issue <list|view|new|update|tree|doctor>' or 'ia-graft task <done|status>' instead",
    );
  }

  const pullSegments = bare.match(/\bgit(?:\.exe)?\s+pull\b[^;&|\r\n]*/gi) ?? [];
  for (const segment of pullSegments) {
    if (!/(?:^|\s)--ff-only(?:\s|$)/i.test(segment)) {
      return denied("AI agents may run git pull only with --ff-only so it cannot create a merge commit; prefer 'ia-graft task sync'");
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
    return evaluateAgentGitCommand(hookInput.tool_input?.command, agent);
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
