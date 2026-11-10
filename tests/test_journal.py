"""The journal: what it writes, and what it throws away."""

from __future__ import annotations

import time
from pathlib import Path

from agentpool.store.journal import Journal


def test_the_events_go_into_the_file_of_the_day(tmp_path: Path) -> None:
    journal = Journal(tmp_path, keep_days=7)
    journal.append({"type": "session_start", "detail": "hello"})

    today = time.strftime("%Y-%m-%d", time.localtime())
    written = tmp_path / f"events-{today}.jsonl"
    assert written.exists()
    assert "session_start" in written.read_text(encoding="utf-8")


def test_the_old_files_are_thrown_away(tmp_path: Path) -> None:
    journal = Journal(tmp_path, keep_days=7)

    now = time.time()
    old = tmp_path / "events-2020-01-01.jsonl"
    recent = tmp_path / "events-2020-02-08.jsonl"
    old.write_text("{}", encoding="utf-8")
    recent.write_text("{}", encoding="utf-8")

    # "now" is in February, so the January file is the old one and the
    # February one is still within the week.
    now = time.mktime(time.strptime("2020-02-10", "%Y-%m-%d"))
    removed = journal.prune(now=now)

    assert removed == [old]
    assert not old.exists()
    assert recent.exists()


def test_the_file_of_today_is_kept(tmp_path: Path) -> None:
    journal = Journal(tmp_path, keep_days=7)
    now = time.time()
    today = tmp_path / f"events-{time.strftime('%Y-%m-%d', time.localtime(now))}.jsonl"
    today.write_text("{}", encoding="utf-8")

    journal.prune(now=now)

    assert today.exists()


def test_a_file_that_is_not_a_journal_file_is_left_alone(tmp_path: Path) -> None:
    journal = Journal(tmp_path, keep_days=7)
    other = tmp_path / "notes.txt"
    other.write_text("hello", encoding="utf-8")

    journal.prune(now=time.time())

    assert other.exists()


def test_a_journal_that_is_off_keeps_everything(tmp_path: Path) -> None:
    journal = Journal(tmp_path, enabled=False, keep_days=7)
    old = tmp_path / "events-2020-01-01.jsonl"
    old.write_text("{}", encoding="utf-8")

    now = time.mktime(time.strptime("2020-02-10", "%Y-%m-%d"))
    assert journal.prune(now=now) == []
    assert old.exists()


def test_a_retention_of_zero_keeps_everything(tmp_path: Path) -> None:
    journal = Journal(tmp_path, keep_days=0)
    old = tmp_path / "events-2020-01-01.jsonl"
    old.write_text("{}", encoding="utf-8")

    now = time.mktime(time.strptime("2020-02-10", "%Y-%m-%d"))
    assert journal.prune(now=now) == []
    assert old.exists()


def test_pruning_a_directory_that_is_not_there_is_not_a_problem(tmp_path: Path) -> None:
    journal = Journal(tmp_path / "missing", keep_days=7)
    assert journal.prune(now=time.time()) == []
