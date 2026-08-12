from pathlib import Path

from automation.control_plane import audit_repository


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def test_minimal_control_plane_audit_has_no_model_calls_or_side_effects() -> None:
    report = audit_repository(REPOSITORY_ROOT, check_graph=False)

    assert report["status"] == "passed"
    assert report["model_calls"] == 0
    assert report["side_effects"] == 0
    assert report["task_count"] >= 0
    assert set(report["adapter_hashes"]) == {"CLAUDE.md", "GEMINI.md", "CODEX.md"}
