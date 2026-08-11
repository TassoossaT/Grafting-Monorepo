import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { delegateRun } from "./delegate-commands.ts";

const fakeExec = (stdout: string) => async (_cmd: string, _args: string[]) => ({ stdout, stderr: "" });
const failingExec = (message: string) => async (_cmd: string, _args: string[]) => {
  throw new Error(message);
};

const roots: string[] = [];
const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "ia-graft-delegate-"));
  roots.push(root);
  return root;
};
test.after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

test("delegateRun rejects a missing prompt", async () => {
  const result = await delegateRun("/repo", { prompt: "" } as never);
  assert.equal(result.ok, false);
});

test("delegateRun rejects an invalid effort", async () => {
  const result = await delegateRun("/repo", { prompt: "hi", effort: "ultra" } as never);
  assert.equal(result.ok, false);
});

test("delegateRun defaults to the high effort when none is given", async () => {
  let calledCli = "";
  let calledArgs: string[] = [];
  const exec = (async (cmd: string, args: string[]) => {
    calledCli = cmd;
    calledArgs = args;
    return { stdout: "ok", stderr: "" };
  }) as never;
  const result = await delegateRun("/repo", { prompt: "hi" }, { exec });
  assert.equal(result.ok, true);
  assert.equal((result as { effort: string }).effort, "high");
  assert.equal(calledCli, "agy");
  assert.equal(calledArgs[calledArgs.indexOf("--model") + 1], "gemini-3.6-flash-high");
  assert.equal(calledArgs[calledArgs.indexOf("--output-format") + 1], "text");
});

test("delegateRun trims stdout and reports the resolved effort/model on success", async () => {
  const result = await delegateRun("/repo", { prompt: "hi", effort: "low" }, { exec: fakeExec("  OK  \n") as never });
  assert.deepEqual(result, { ok: true, output: "OK", effort: "low", model: "gemini-3.6-flash-low" });
});

test("delegateRun surfaces a generic failure when the CLI is missing", async () => {
  const result = await delegateRun("/repo", { prompt: "hi" }, { exec: failingExec("spawn agy ENOENT") as never });
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /delegate run failed.*ENOENT/);
});

test("delegateRun recognizes quota/credit exhaustion and points at delegate-profiles.ts", async () => {
  const result = await delegateRun("/repo", { prompt: "hi" }, { exec: failingExec("Error: 429 Resource has been exhausted (quota)") as never });
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /out of quota\/credits/);
  assert.match((result as { error: string }).error, /delegate-profiles\.ts/);
});

test("delegateRun embeds a repo file's content into the prompt sent to the CLI", async () => {
  const root = await makeRoot();
  await writeFile(join(root, "notes.md"), "the file content", "utf8");
  let calledArgs: string[] = [];
  const exec = (async (_cmd: string, args: string[]) => {
    calledArgs = args;
    return { stdout: "ok", stderr: "" };
  }) as never;
  const result = await delegateRun(root, { prompt: "summarize this", file: "notes.md" }, { exec });
  assert.equal(result.ok, true);
  const sentPrompt = calledArgs[calledArgs.indexOf("-p") + 1]!;
  assert.match(sentPrompt, /summarize this/);
  assert.match(sentPrompt, /notes\.md/);
  assert.match(sentPrompt, /the file content/);
});

test("delegateRun rejects a file path that escapes the repo root", async () => {
  const root = await makeRoot();
  const result = await delegateRun(root, { prompt: "hi", file: "../outside.md" });
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /must be inside the repo/);
});

test("delegateRun rejects a missing file", async () => {
  const root = await makeRoot();
  const result = await delegateRun(root, { prompt: "hi", file: "does-not-exist.md" });
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /could not read file/);
});

test("delegateRun requests json output and unwraps structured_output when a schema is given", async () => {
  let calledArgs: string[] = [];
  const exec = (async (_cmd: string, args: string[]) => {
    calledArgs = args;
    return { stdout: JSON.stringify({ status: "SUCCESS", structured_output: { answer: "OK" } }), stderr: "" };
  }) as never;
  const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
  const result = await delegateRun("/repo", { prompt: "hi", jsonSchema: schema }, { exec });
  assert.deepEqual(result, { ok: true, output: { answer: "OK" }, effort: "high", model: "gemini-3.6-flash-high" });
  assert.equal(calledArgs[calledArgs.indexOf("--output-format") + 1], "json");
  assert.equal(calledArgs[calledArgs.indexOf("--json-schema") + 1], JSON.stringify(schema));
});

test("delegateRun fails clearly when the CLI's json output has no structured_output", async () => {
  const exec = fakeExec(JSON.stringify({ status: "SUCCESS" })) as never;
  const result = await delegateRun("/repo", { prompt: "hi", jsonSchema: { type: "object" } }, { exec });
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /did not return structured output/);
});
