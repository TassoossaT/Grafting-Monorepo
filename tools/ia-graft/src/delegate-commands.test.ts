import assert from "node:assert/strict";
import test from "node:test";
import { delegateRun } from "./delegate-commands.ts";

const fakeExec = (stdout: string) => async (_cmd: string, _args: string[]) => ({ stdout, stderr: "" });
const failingExec = (message: string) => async (_cmd: string, _args: string[]) => {
  throw new Error(message);
};

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
