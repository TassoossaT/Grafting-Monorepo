// Node has no alias table of its own, but product source (e.g. wall-line-tool.ts)
// imports "@/..." expecting one. This factory builds a `resolve` hook that maps
// "@/foo" to "<srcUrl>foo(.ts|/index.ts)", for use with `node:module`'s
// `registerHooks` (synchronous, in-thread -- no `--import` flag required) or
// `register` (async loader-thread hook). Register it BEFORE dynamically
// importing anything that transitively imports "@/...".
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export function createAliasResolveHook(srcUrl) {
  function resolveFile(url) {
    const path = fileURLToPath(url);
    for (const candidate of [path, `${path}.ts`, `${path}/index.ts`]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return pathToFileURL(candidate).href;
    }
    return url.href;
  }
  return {
    resolve(specifier, context, next) {
      if (specifier.startsWith("@/")) return next(resolveFile(new URL(specifier.slice(2), srcUrl)), context);
      return next(specifier, context);
    },
  };
}
