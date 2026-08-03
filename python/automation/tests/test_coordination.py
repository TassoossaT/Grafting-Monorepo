import json
from pathlib import Path

import pytest

from automation.coordination import (
    CoordinationValidationError,
    _validate_task,
    organize_tasks,
    validate_repository,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def test_repository_coordination_state_is_valid() -> None:
    task_ids = validate_repository(REPOSITORY_ROOT)

    assert "COORDINATION-PHASE1" in task_ids


def test_in_progress_task_requires_a_known_owner(tmp_path: Path) -> None:
    task = json.loads(
        (REPOSITORY_ROOT / ".ai" / "state" / "tasks" / "completed" / "COORDINATION-PHASE1.json").read_text(
            encoding="utf-8"
        )
    )
    task["status"] = "in_progress"
    task["owner"] = "unknown-provider"
    path = tmp_path / "COORDINATION-PHASE1.json"

    with pytest.raises(CoordinationValidationError, match="unknown owner"):
        _validate_task(path, task, {"codex"})


def _minimal_task(**overrides: object) -> dict[str, object]:
    task: dict[str, object] = {
        "schema_version": 1,
        "task_id": "SOME-TASK",
        "title": "t",
        "status": "completed",
        "owner": None,
        "revision": 1,
        "updated_at": "2026-01-01T00:00:00Z",
        "objective": "o",
        "affected_paths": [],
        "blockers": [],
        "validations": [],
        "artifacts": [],
        "risks": [],
        "next_responsible_party": None,
    }
    task.update(overrides)
    return task


def test_organize_tasks_moves_flat_and_misplaced_records(tmp_path: Path) -> None:
    task_dir = tmp_path / ".ai" / "state" / "tasks"
    task_dir.mkdir(parents=True)

    flat = _minimal_task(task_id="FLAT-TASK", status="completed")
    (task_dir / "FLAT-TASK.json").write_text(json.dumps(flat), encoding="utf-8")

    misplaced_dir = task_dir / "completed"
    misplaced_dir.mkdir()
    misplaced = _minimal_task(task_id="MISPLACED-TASK", status="in_progress", owner="claude")
    (misplaced_dir / "MISPLACED-TASK.json").write_text(json.dumps(misplaced), encoding="utf-8")

    already_correct = _minimal_task(task_id="ALREADY-CORRECT-TASK")
    (misplaced_dir / "ALREADY-CORRECT-TASK.json").write_text(
        json.dumps(already_correct), encoding="utf-8"
    )

    moved = organize_tasks(tmp_path)

    assert {new.stem for _, new in moved} == {"FLAT-TASK", "MISPLACED-TASK"}
    assert (task_dir / "completed" / "FLAT-TASK.json").is_file()
    assert (task_dir / "in_progress" / "MISPLACED-TASK.json").is_file()
    assert not (task_dir / "FLAT-TASK.json").exists()
    assert not (misplaced_dir / "MISPLACED-TASK.json").exists()
    # A second run is a no-op: everything is already in its right place.
    assert organize_tasks(tmp_path) == []


def test_organize_tasks_refuses_to_overwrite_an_existing_file(tmp_path: Path) -> None:
    task_dir = tmp_path / ".ai" / "state" / "tasks"
    (task_dir / "completed").mkdir(parents=True)
    task = _minimal_task(task_id="DUP")
    (task_dir / "DUP.json").write_text(json.dumps(task), encoding="utf-8")
    (task_dir / "completed" / "DUP.json").write_text(json.dumps(task), encoding="utf-8")

    with pytest.raises(CoordinationValidationError, match="already exists"):
        organize_tasks(tmp_path)


def test_organize_tasks_rejects_an_invalid_status(tmp_path: Path) -> None:
    task_dir = tmp_path / ".ai" / "state" / "tasks"
    task_dir.mkdir(parents=True)
    task = _minimal_task(task_id="BAD", status="not-a-real-status")
    (task_dir / "BAD.json").write_text(json.dumps(task), encoding="utf-8")

    with pytest.raises(CoordinationValidationError, match="invalid or missing status"):
        organize_tasks(tmp_path)
