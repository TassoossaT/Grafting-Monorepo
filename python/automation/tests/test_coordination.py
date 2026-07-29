import json
from pathlib import Path

import pytest

from automation.coordination import (
    CoordinationValidationError,
    _validate_task,
    validate_repository,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def test_repository_coordination_state_is_valid() -> None:
    task_ids = validate_repository(REPOSITORY_ROOT)

    assert "COORDINATION-PHASE1" in task_ids


def test_in_progress_task_requires_a_known_owner(tmp_path: Path) -> None:
    task = json.loads(
        (REPOSITORY_ROOT / ".ai" / "state" / "tasks" / "COORDINATION-PHASE1.json").read_text(
            encoding="utf-8"
        )
    )
    task["status"] = "in_progress"
    task["owner"] = "unknown-provider"
    path = tmp_path / "COORDINATION-PHASE1.json"

    with pytest.raises(CoordinationValidationError, match="unknown owner"):
        _validate_task(path, task, {"codex"})
