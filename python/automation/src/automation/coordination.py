"""Validate provider-neutral coordination state without model calls.

The registry files use JSON syntax with a ``.yaml`` suffix. JSON is a YAML 1.2
subset, which keeps the canonical names from the master source while allowing
validation with Python's standard library and no new dependency.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any


TASK_ID = re.compile(r"^[A-Z][A-Z0-9-]{2,63}$")
TASK_STATUSES = {"planned", "in_progress", "blocked", "completed", "cancelled"}
TASK_FIELDS = {
    "schema_version",
    "task_id",
    "title",
    "status",
    "owner",
    "revision",
    "updated_at",
    "objective",
    "affected_paths",
    "blockers",
    "validations",
    "artifacts",
    "risks",
    "next_responsible_party",
}
HANDOFF_FIELDS = {
    "schema_version",
    "handoff_id",
    "created_at",
    "task_id",
    "sender",
    "recipient",
    "objective",
    "context",
    "criteria",
    "constraints",
    "uncertainties",
    "artifacts",
    "current_owner",
    "return_schema",
    "next_responsible_party",
}


class CoordinationValidationError(ValueError):
    """Raised when canonical coordination state is invalid."""


def _read_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CoordinationValidationError(f"{path}: cannot parse JSON: {error}") from error
    if not isinstance(value, dict):
        raise CoordinationValidationError(f"{path}: root must be an object")
    return value


def _require_exact_fields(path: Path, value: dict[str, Any], fields: set[str]) -> None:
    missing = sorted(fields - value.keys())
    extra = sorted(value.keys() - fields)
    if missing or extra:
        raise CoordinationValidationError(
            f"{path}: fields differ; missing={missing}, extra={extra}"
        )


def _require_string(path: Path, value: Any, field: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise CoordinationValidationError(f"{path}: {field} must be a non-empty string")


def _require_string_list(path: Path, value: Any, field: str, *, unique: bool = False) -> None:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise CoordinationValidationError(f"{path}: {field} must be a string array")
    if unique and len(value) != len(set(value)):
        raise CoordinationValidationError(f"{path}: {field} must contain unique values")


def _require_datetime(path: Path, value: Any, field: str) -> None:
    _require_string(path, value, field)
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise CoordinationValidationError(f"{path}: {field} is not an ISO date-time") from error


def _load_agent_ids(root: Path) -> set[str]:
    path = root / ".ai" / "registry" / "agents.yaml"
    registry = _read_object(path)
    if registry.get("schema_version") != 1 or not isinstance(registry.get("agents"), list):
        raise CoordinationValidationError(f"{path}: invalid registry envelope")
    ids: list[str] = []
    for index, agent in enumerate(registry["agents"]):
        if not isinstance(agent, dict):
            raise CoordinationValidationError(f"{path}: agents[{index}] must be an object")
        if set(agent) != {"id", "provider", "summary"}:
            raise CoordinationValidationError(f"{path}: agents[{index}] has invalid fields")
        for field in ("id", "provider", "summary"):
            _require_string(path, agent.get(field), f"agents[{index}].{field}")
        ids.append(agent["id"])
    if len(ids) != len(set(ids)):
        raise CoordinationValidationError(f"{path}: agent IDs must be unique")
    return set(ids)


def _validate_policy_registry(root: Path) -> None:
    path = root / ".ai" / "registry" / "policies.yaml"
    registry = _read_object(path)
    if registry.get("schema_version") != 1 or not isinstance(registry.get("policies"), list):
        raise CoordinationValidationError(f"{path}: invalid registry envelope")
    ids: list[str] = []
    for index, policy in enumerate(registry["policies"]):
        if not isinstance(policy, dict) or set(policy) != {"id", "status", "source", "summary"}:
            raise CoordinationValidationError(f"{path}: policies[{index}] has invalid fields")
        for field in ("id", "status", "source", "summary"):
            _require_string(path, policy.get(field), f"policies[{index}].{field}")
        if not (root / policy["source"]).is_file():
            raise CoordinationValidationError(f"{path}: missing policy source {policy['source']}")
        ids.append(policy["id"])
    if len(ids) != len(set(ids)):
        raise CoordinationValidationError(f"{path}: policy IDs must be unique")


def _validate_schema_documents(root: Path) -> None:
    for name in ("task.schema.json", "handoff.schema.json", "capability.schema.json"):
        path = root / ".ai" / "contracts" / name
        schema = _read_object(path)
        if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
            raise CoordinationValidationError(f"{path}: unsupported JSON Schema dialect")
        if schema.get("type") != "object" or schema.get("additionalProperties") is not False:
            raise CoordinationValidationError(f"{path}: schema must define a closed object")
        if not isinstance(schema.get("required"), list) or not isinstance(schema.get("properties"), dict):
            raise CoordinationValidationError(f"{path}: schema requires required/properties")
        if set(schema["required"]) != set(schema["properties"]):
            raise CoordinationValidationError(f"{path}: every property must be required in v1")


def _validate_capability_registry(root: Path) -> None:
    path = root / ".ai" / "registry" / "capabilities.yaml"
    registry = _read_object(path)
    capabilities = registry.get("capabilities")
    if registry.get("schema_version") != 1 or not isinstance(capabilities, list):
        raise CoordinationValidationError(f"{path}: invalid registry envelope")
    fields = {"id", "summary", "command", "risk", "side_effects", "sources"}
    ids: list[str] = []
    for index, capability in enumerate(capabilities):
        if not isinstance(capability, dict) or set(capability) != fields:
            raise CoordinationValidationError(f"{path}: capabilities[{index}] has invalid fields")
        for field in ("id", "summary", "command"):
            _require_string(path, capability[field], f"capabilities[{index}].{field}")
        if not re.fullmatch(r"[a-z][a-z0-9.-]+", capability["id"]):
            raise CoordinationValidationError(f"{path}: invalid capability ID {capability['id']!r}")
        if capability["risk"] not in {"low", "medium", "high"}:
            raise CoordinationValidationError(f"{path}: invalid capability risk")
        if not isinstance(capability["side_effects"], bool):
            raise CoordinationValidationError(f"{path}: side_effects must be boolean")
        _require_string_list(path, capability["sources"], "sources", unique=True)
        if not capability["sources"]:
            raise CoordinationValidationError(f"{path}: every capability requires a source")
        for source in capability["sources"]:
            if not (root / source).exists():
                raise CoordinationValidationError(f"{path}: missing capability source {source}")
        ids.append(capability["id"])
    if len(ids) != len(set(ids)):
        raise CoordinationValidationError(f"{path}: capability IDs must be unique")


def _validate_workflow_registry(root: Path) -> None:
    path = root / ".ai" / "registry" / "workflows.yaml"
    registry = _read_object(path)
    workflows = registry.get("workflows")
    if registry.get("schema_version") != 1 or not isinstance(workflows, list):
        raise CoordinationValidationError(f"{path}: invalid registry envelope")
    fields = {"id", "status", "summary", "policy", "steps"}
    ids: list[str] = []
    for index, workflow in enumerate(workflows):
        if not isinstance(workflow, dict) or set(workflow) != fields:
            raise CoordinationValidationError(f"{path}: workflows[{index}] has invalid fields")
        for field in ("id", "status", "summary", "policy"):
            _require_string(path, workflow[field], f"workflows[{index}].{field}")
        if workflow["status"] != "active":
            raise CoordinationValidationError(f"{path}: only active workflows belong in the minimal registry")
        if not (root / workflow["policy"]).is_file():
            raise CoordinationValidationError(f"{path}: missing workflow policy {workflow['policy']}")
        _require_string_list(path, workflow["steps"], "steps", unique=True)
        if not workflow["steps"]:
            raise CoordinationValidationError(f"{path}: workflow requires at least one step")
        ids.append(workflow["id"])
    if len(ids) != len(set(ids)):
        raise CoordinationValidationError(f"{path}: workflow IDs must be unique")


def _validate_task(path: Path, value: dict[str, Any], agent_ids: set[str]) -> str:
    # Pop and validate optional fields first, so they are not treated as "extra".
    scope = value.pop("scope", None)
    if scope is not None and not isinstance(scope, str):
        raise CoordinationValidationError(f"{path}: scope must be a string")

    related_tasks = value.pop("related_tasks", None)
    if related_tasks is not None:
        _require_string_list(path, related_tasks, "related_tasks", unique=True)

    _require_exact_fields(path, value, TASK_FIELDS)
    if value["schema_version"] != 1:
        raise CoordinationValidationError(f"{path}: schema_version must be 1")
    _require_string(path, value["task_id"], "task_id")
    if not TASK_ID.fullmatch(value["task_id"]):
        raise CoordinationValidationError(f"{path}: invalid task_id")
    if path.stem != value["task_id"]:
        raise CoordinationValidationError(f"{path}: filename must match task_id")
    _require_string(path, value["title"], "title")
    _require_string(path, value["objective"], "objective")
    if value["status"] not in TASK_STATUSES:
        raise CoordinationValidationError(f"{path}: invalid status {value['status']!r}")
    owner = value["owner"]
    if owner is not None and owner not in agent_ids:
        raise CoordinationValidationError(f"{path}: unknown owner {owner!r}")
    if value["status"] == "in_progress" and owner is None:
        raise CoordinationValidationError(f"{path}: in_progress task requires an owner")
    if not isinstance(value["revision"], int) or isinstance(value["revision"], bool) or value["revision"] < 1:
        raise CoordinationValidationError(f"{path}: revision must be a positive integer")
    _require_datetime(path, value["updated_at"], "updated_at")
    for field in ("affected_paths", "artifacts"):
        _require_string_list(path, value[field], field, unique=True)
    for field in ("blockers", "validations", "risks"):
        _require_string_list(path, value[field], field)
    next_party = value["next_responsible_party"]
    if next_party is not None and next_party not in agent_ids:
        raise CoordinationValidationError(f"{path}: unknown next_responsible_party {next_party!r}")
    return value["task_id"]


def _validate_handoff(
    path: Path, value: dict[str, Any], agent_ids: set[str], task_ids: set[str]
) -> None:
    _require_exact_fields(path, value, HANDOFF_FIELDS)
    if value["schema_version"] != 1:
        raise CoordinationValidationError(f"{path}: schema_version must be 1")
    for field in ("handoff_id", "task_id", "objective", "return_schema"):
        _require_string(path, value[field], field)
    if value["task_id"] not in task_ids:
        raise CoordinationValidationError(f"{path}: unknown task_id {value['task_id']!r}")
    _require_datetime(path, value["created_at"], "created_at")
    for field in ("sender", "recipient", "next_responsible_party"):
        if value[field] not in agent_ids:
            raise CoordinationValidationError(f"{path}: unknown {field} {value[field]!r}")
    current_owner = value["current_owner"]
    if current_owner is not None and current_owner not in agent_ids:
        raise CoordinationValidationError(f"{path}: unknown current_owner {current_owner!r}")
    for field in ("context", "criteria", "constraints", "uncertainties", "artifacts"):
        _require_string_list(path, value[field], field)


def organize_tasks(root: Path) -> list[tuple[Path, Path]]:
    """Moves every task record under .ai/state/tasks/ into the status
    subdirectory matching its own ``status`` field (creating that
    subdirectory on demand), regardless of whether it currently sits flat
    at the top level or already inside some subdirectory. Returns every
    ``(old_path, new_path)`` pair actually moved; a file already in the
    right place is left untouched and not included."""

    root = root.resolve()
    task_dir = root / ".ai" / "state" / "tasks"
    moved: list[tuple[Path, Path]] = []
    for path in sorted(task_dir.rglob("*.json")):
        value = _read_object(path)
        status = value.get("status")
        if status not in TASK_STATUSES:
            raise CoordinationValidationError(
                f"{path}: cannot organize, invalid or missing status {status!r}"
            )
        target_path = task_dir / status / path.name
        if path == target_path:
            continue
        if target_path.exists():
            raise CoordinationValidationError(
                f"{path}: cannot move to {target_path}, a file already exists there"
            )
        target_path.parent.mkdir(parents=True, exist_ok=True)
        path.rename(target_path)
        moved.append((path, target_path))
    return moved


def find_task_paths(root: Path) -> dict[str, Path]:
    """Maps every task_id found under a status subdirectory to its file path.

    This is the one shared place that knows how to locate a task record by
    ID across the status-subdirectory layout, so other tools (e.g.
    ``control_plane.py``) don't each grow their own flat-path assumption."""

    root = root.resolve()
    task_dir = root / ".ai" / "state" / "tasks"
    paths: dict[str, Path] = {}
    for status in TASK_STATUSES:
        status_dir = task_dir / status
        if status_dir.is_dir():
            for path in sorted(status_dir.glob("*.json")):
                paths[path.stem] = path
    return paths


def validate_repository(root: Path) -> list[str]:
    """Validate all canonical coordination artifacts and return task IDs."""

    root = root.resolve()
    _validate_schema_documents(root)
    agent_ids = _load_agent_ids(root)
    _validate_policy_registry(root)
    _validate_capability_registry(root)
    _validate_workflow_registry(root)

    # Deliberately not built from find_task_paths(): that function returns a
    # dict keyed by task_id, which would silently collapse two records that
    # share an ID across different status subdirectories -- exactly the
    # case the uniqueness check just below exists to catch.
    task_dir = root / ".ai" / "state" / "tasks"
    task_paths = []
    for status in TASK_STATUSES:
        status_dir = task_dir / status
        if status_dir.is_dir():
            task_paths.extend(status_dir.glob("*.json"))
    task_paths.sort()

    if not task_paths:
        raise CoordinationValidationError(f"{task_dir}: no task records were found in status subdirectories")
    task_ids = {_validate_task(path, _read_object(path), agent_ids) for path in task_paths}
    if len(task_ids) != len(task_paths):
        raise CoordinationValidationError(f"{task_dir}: task IDs must be unique across all subdirectories")

    handoff_dir = root / ".ai" / "state" / "handoffs"
    for path in sorted(handoff_dir.glob("*.json")):
        _validate_handoff(path, _read_object(path), agent_ids, task_ids)
    return sorted(task_ids)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--organize",
        action="store_true",
        help=(
            "Before validating, move every task record into the "
            ".ai/state/tasks/<status>/ subdirectory matching its own status "
            "field, wherever it currently sits."
        ),
    )
    args = parser.parse_args(argv)
    if args.organize:
        try:
            moved = organize_tasks(args.root)
        except CoordinationValidationError as error:
            parser.exit(1, f"task organization failed: {error}\n")
        for old_path, new_path in moved:
            print(f"organized: {old_path} -> {new_path}")
        print(f"organized {len(moved)} task record(s)")
    try:
        task_ids = validate_repository(args.root)
    except CoordinationValidationError as error:
        parser.exit(1, f"coordination validation failed: {error}\n")
    print(f"coordination validation passed: {len(task_ids)} task(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
