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
    for name in ("task.schema.json", "handoff.schema.json"):
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


def _validate_task(path: Path, value: dict[str, Any], agent_ids: set[str]) -> str:
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


def validate_repository(root: Path) -> list[str]:
    """Validate all canonical coordination artifacts and return task IDs."""

    root = root.resolve()
    _validate_schema_documents(root)
    agent_ids = _load_agent_ids(root)
    _validate_policy_registry(root)

    task_dir = root / ".ai" / "state" / "tasks"
    task_paths = sorted(task_dir.glob("*.json"))
    if not task_paths:
        raise CoordinationValidationError(f"{task_dir}: at least one task record is required")
    task_ids = {_validate_task(path, _read_object(path), agent_ids) for path in task_paths}
    if len(task_ids) != len(task_paths):
        raise CoordinationValidationError(f"{task_dir}: task IDs must be unique")

    handoff_dir = root / ".ai" / "state" / "handoffs"
    for path in sorted(handoff_dir.glob("*.json")):
        _validate_handoff(path, _read_object(path), agent_ids, task_ids)
    return sorted(task_ids)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    try:
        task_ids = validate_repository(args.root)
    except CoordinationValidationError as error:
        parser.exit(1, f"coordination validation failed: {error}\n")
    print(f"coordination validation passed: {len(task_ids)} task(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
