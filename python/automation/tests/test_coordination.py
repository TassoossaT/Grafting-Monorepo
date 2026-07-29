import json
from pathlib import Path

import pytest

from automation.coordination import CoordinationValidationError, validate_repository


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def test_repository_coordination_state_is_valid() -> None:
    task_ids = validate_repository(REPOSITORY_ROOT)

    assert "COORDINATION-PHASE1" in task_ids


def test_in_progress_task_requires_a_known_owner(tmp_path: Path) -> None:
    ai_root = tmp_path / ".ai"
    for source in (
        REPOSITORY_ROOT / ".ai" / "contracts",
        REPOSITORY_ROOT / ".ai" / "registry",
        REPOSITORY_ROOT / ".ai" / "coordination",
    ):
        destination = ai_root / source.name
        destination.mkdir(parents=True)
        for file in source.iterdir():
            destination.joinpath(file.name).write_bytes(file.read_bytes())

    task_dir = ai_root / "state" / "tasks"
    task_dir.mkdir(parents=True)
    (ai_root / "state" / "handoffs").mkdir(parents=True)
    task = json.loads(
        (REPOSITORY_ROOT / ".ai" / "state" / "tasks" / "COORDINATION-PHASE1.json").read_text(
            encoding="utf-8"
        )
    )
    task["owner"] = "unknown-provider"
    (task_dir / "COORDINATION-PHASE1.json").write_text(json.dumps(task), encoding="utf-8")

    with pytest.raises(CoordinationValidationError, match="unknown owner"):
        validate_repository(tmp_path)
