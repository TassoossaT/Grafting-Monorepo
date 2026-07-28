from automation import placeholder_version


def test_placeholder_version_is_not_empty() -> None:
    assert placeholder_version() != ""
