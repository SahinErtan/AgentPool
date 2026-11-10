"""The ``agentpool`` command."""

from __future__ import annotations

import json

from agentpool import cli


def _agent(agent_id: str, status: str = "working", label: str = "main"):
    return {
        "id": agent_id,
        "status": status,
        "label": label,
        "kind": "session",
        "detail": "/home/somewhere",
        "presentation": {"mode": "swim"},
    }


def _state(agents=None):
    agents = agents if agents is not None else [_agent("session:a")]
    return {
        "type": "snapshot",
        "agents": agents,
        "counts": {"working": 1, "idle": 0, "total": len(agents)},
    }


def test_the_table_says_how_many_are_working():
    text = cli.render(_state())
    assert "1 working" in text
    assert "0 idle" in text
    assert "session:a" not in text  # the id is not the label
    assert "main" in text


def test_an_empty_pool_says_so():
    text = cli.render(_state(agents=[]))
    assert "the pool is empty" in text


def test_a_long_detail_is_cut_short():
    agent = _agent("session:a")
    agent["detail"] = "x" * 200
    line = cli.agent_line(agent)
    assert len(line) < 120
    assert line.endswith("...")


def test_the_state_signature_changes_when_an_agent_moves():
    first = _signature_of([_agent("session:a", "working")])
    second = _signature_of([_agent("session:a", "idle")])
    assert first != second


def _signature_of(agents):
    return cli._signature({"agents": agents})


def test_the_agent_details_show_the_events():
    agent = _agent("session:a")
    agent["events"] = [
        {"type": "started", "tool_name": "Read", "detail": "a file"},
        {"type": "finished", "tool_name": "", "detail": "done"},
    ]
    text = cli.render_agent(agent)
    assert "the last events:" in text
    assert "Read" in text


def test_the_json_output_is_json(capsys, monkeypatch):
    monkeypatch.setattr(cli, "fetch", lambda url, timeout=3.0: _state())
    assert cli.main(["--json"]) == cli.EXIT_OK
    printed = json.loads(capsys.readouterr().out)
    assert printed["counts"]["total"] == 1


def test_an_unreachable_pool_is_reported(capsys, monkeypatch):
    def boom(url, timeout=3.0):
        raise OSError("connection refused")

    monkeypatch.setattr(cli, "fetch", boom)
    assert cli.main([]) == cli.EXIT_UNREACHABLE
    assert "not answering" in capsys.readouterr().err


def test_an_unknown_agent_has_its_own_exit_code(capsys, monkeypatch):
    class NotFound(Exception):
        pass

    import urllib.error

    def boom(url, timeout=3.0):
        raise urllib.error.HTTPError(url, 404, "unknown agent", None, None)

    monkeypatch.setattr(cli, "fetch", boom)
    assert cli.main(["--agent", "session:nope"]) == cli.EXIT_UNKNOWN_AGENT
    assert "no agent called" in capsys.readouterr().err
