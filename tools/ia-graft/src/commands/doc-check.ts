import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface DocCheckResult {
  [key: string]: unknown;
  ok: true;
  passed: boolean;
  checks: Array<{ file: string; lineCount: number; maxLines: number; passed: boolean; reason?: string }>;
}

const LIMITS: Array<{ file: string; maxLines: number }> = [
  { file: "AGENTS.md", maxLines: 100 },
  { file: "GEMINI.md", maxLines: 30 },
  { file: "CLAUDE.md", maxLines: 30 },
];

export async function runDocCheck(repoRoot: string): Promise<DocCheckResult> {
  const checks: DocCheckResult["checks"] = [];
  let allPassed = true;

  for (const item of LIMITS) {
    const filePath = join(repoRoot, item.file);
    try {
      const content = await readFile(filePath, "utf8");
      const lineCount = content.split(/\r?\n/).length;
      const passed = lineCount <= item.maxLines;
      if (!passed) allPassed = false;
      checks.push({
        file: item.file,
        lineCount,
        maxLines: item.maxLines,
        passed,
        reason: passed ? undefined : `file has ${lineCount} lines (limit: ${item.maxLines})`,
      });
    } catch (error) {
      allPassed = false;
      checks.push({
        file: item.file,
        lineCount: 0,
        maxLines: item.maxLines,
        passed: false,
        reason: `file missing or unreadable: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return { ok: true, passed: allPassed, checks };
}
