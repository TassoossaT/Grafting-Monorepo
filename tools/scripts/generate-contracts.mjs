import { execFileSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

const schemas = [
  "libs/engine/domain-core/contracts/command.fbs",
  "libs/engine/domain-core/contracts/domain_event.fbs",
  "libs/engine/domain-core/contracts/snapshot.fbs",
];

const obsoleteMapStateOutputs = [
  "libs/engine/domain-core/src/generated/map_state_generated.rs",
  "packages/isekai-web-client/src/generated/grafting/contracts/boundary-kind.ts",
  "packages/isekai-web-client/src/generated/grafting/contracts/boundary-patch.ts",
  "packages/isekai-web-client/src/generated/grafting/contracts/boundary-segment.ts",
  "packages/isekai-web-client/src/generated/grafting/contracts/map-state-message.ts",
  "packages/isekai-web-client/src/generated/grafting/contracts/prism-cell-assignment.ts",
  "packages/isekai-web-client/src/generated/grafting/contracts/vec3.ts",
  "dotnet/Grafting.Isekai.Protocol/Generated/Grafting/Contracts/BoundaryKind.cs",
  "dotnet/Grafting.Isekai.Protocol/Generated/Grafting/Contracts/BoundaryPatch.cs",
  "dotnet/Grafting.Isekai.Protocol/Generated/Grafting/Contracts/BoundarySegment.cs",
  "dotnet/Grafting.Isekai.Protocol/Generated/Grafting/Contracts/MapStateMessage.cs",
  "dotnet/Grafting.Isekai.Protocol/Generated/Grafting/Contracts/PrismCellAssignment.cs",
  "dotnet/Grafting.Isekai.Protocol/Generated/Grafting/Contracts/Vec3.cs",
];

for (const relPath of obsoleteMapStateOutputs) {
  const fullPath = resolve(root, relPath);
  if (existsSync(fullPath)) {
    try { unlinkSync(fullPath); } catch {}
  }
}

// 1. Rust
execFileSync("flatc", ["--rust", "-o", "libs/engine/domain-core/src/generated", ...schemas], { cwd: root, stdio: "inherit" });

// 2. TS
execFileSync("flatc", ["--ts", "-o", "packages/isekai-web-client/src/generated", ...schemas], { cwd: root, stdio: "inherit" });

// 3. C# (only if powershell is available)
if (platform() === "win32") {
  try {
    execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tools/scripts/generate-contracts.ps1"], { cwd: root, stdio: "inherit" });
  } catch (err) {
    console.warn("PowerShell C# contract generation skipped:", err.message);
  }
}
