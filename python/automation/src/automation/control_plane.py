"""Read-only deterministic audit for the minimal AI Control Plane."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any

from automation.coordination import CoordinationValidationError, validate_repository


class ControlPlaneAuditError(ValueError):
    """Raised when the minimal control plane drifts or fails validation."""


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit_repository(root: Path, *, check_graph: bool = True) -> dict[str, Any]:
    """Audit canonical state without writing files or calling a model."""

    root = root.resolve()
    task_ids = validate_repository(root)
    task_records = [
        json.loads((root / ".ai" / "state" / "tasks" / f"{task_id}.json").read_text(encoding="utf-8"))
        for task_id in task_ids
    ]
    statuses = Counter(task["status"] for task in task_records)

    adapter_hashes: dict[str, str] = {}
    for name in ("CLAUDE.md", "GEMINI.md"):
        path = root / name
        text = path.read_text(encoding="utf-8")
        for required in ("AGENTS.md", "GRAFTING_MASTER_SOURCE.md", ".ai/coordination/PROTOCOL.md"):
            if required not in text:
                raise ControlPlaneAuditError(f"{name} does not point to {required}")
        if len(text) > 3_000:
            raise ControlPlaneAuditError(f"{name} is no longer a short adapter")
        adapter_hashes[name] = _digest(path)

    graph_status = "skipped"
    if check_graph:
        result = subprocess.run(
            ["node", "tools/scripts/generate-graph-ir.mjs", "--check"],
            cwd=root,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise ControlPlaneAuditError(f"Graph IR freshness failed: {result.stderr.strip()}")
        graph_status = "current"

    return {
        "report_version": 1,
        "status": "passed",
        "model_calls": 0,
        "side_effects": 0,
        "task_count": len(task_ids),
        "task_statuses": dict(sorted(statuses.items())),
        "adapter_hashes": adapter_hashes,
        "graph_candidate": graph_status,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--skip-graph", action="store_true")
    args = parser.parse_args(argv)
    try:
        report = audit_repository(args.root, check_graph=not args.skip_graph)
    except (ControlPlaneAuditError, CoordinationValidationError) as error:
        parser.exit(1, f"control-plane audit failed: {error}\n")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
