"""The normaliser, tested over the payloads Claude Code actually sent.

The payloads below were captured from real ``claude`` runs on this machine;
their key sets are exactly what the server received.
"""

from __future__ import annotations

from agentpool.bridge.events import AgentEvent, AgentStatus, SessionEvent
from agentpool.bridge.normalizer import normalise_agent_id, normalize

# Captured from a real `claude -p` run.
REAL_SESSION_START = {
    "cwd": "/tmp/hooktest",
    "hook_event_name": "SessionStart",
    "session_id": "d1307310-8bf6-43f3-b935-49356082cb89",
    "source": "startup",
    "transcript_path": "/home/alice/.claude/projects/-tmp-hooktest/d1307310.jsonl",
}

REAL_USER_PROMPT = {
    "cwd": "/tmp/hooktest",
    "hook_event_name": "UserPromptSubmit",
    "permission_mode": "default",
    "prompt": "Reply with exactly: ok",
    "prompt_id": "b8f0a2c1-1111-2222-3333-444455556666",
    "session_id": "d1307310-8bf6-43f3-b935-49356082cb89",
    "transcript_path": "/home/alice/.claude/projects/-tmp-hooktest/d1307310.jsonl",
}

REAL_STOP = {
    "background_tasks": [],
    "cwd": "/tmp/hooktest",
    "effort": {"level": "medium"},
    "hook_event_name": "Stop",
    "last_assistant_message": "ok",
    "permission_mode": "default",
    "prompt_id": "b8f0a2c1-1111-2222-3333-444455556666",
    "session_crons": [],
    "session_id": "d1307310-8bf6-43f3-b935-49356082cb89",
    "stop_hook_active": False,
    "transcript_path": "/home/alice/.claude/projects/-tmp-hooktest/d1307310.jsonl",
}

REAL_SUBAGENT_START = {
    "agent_id": "a1b2c3d4e5f60718",
    "agent_type": "Explore",
    "cwd": "/tmp/hooktest",
    "hook_event_name": "SubagentStart",
    "session_id": "d1307310-8bf6-43f3-b935-49356082cb89",
    "transcript_path": "/home/alice/.claude/projects/-tmp-hooktest/d1307310.jsonl",
}

REAL_SUBAGENT_STOP = {
    "agent_id": "a1b2c3d4e5f60718",
    "agent_type": "Explore",
    "hook_event_name": "SubagentStop",
    "last_assistant_message": "done",
    "session_id": "d1307310-8bf6-43f3-b935-49356082cb89",
    "stop_hook_active": False,
    "transcript_path": "/home/alice/.claude/projects/-tmp-hooktest/d1307310.jsonl",
    "agent_transcript_path": "/home/alice/.claude/projects/-tmp-hooktest/x/subagents/agent-a1b2.jsonl",
}

REAL_AGENT_TOOL_RESULT = {
    "cwd": "/tmp/hooktest",
    "hook_event_name": "PostToolUse",
    "session_id": "d1307310-8bf6-43f3-b935-49356082cb89",
    "tool_name": "Agent",
    "tool_input": {"description": "scout the repo", "prompt": "...", "subagent_type": "Explore"},
    "tool_use_id": "call-af5964fa-1d05-49b7-94e6-5d1a7dc6558c",
    "tool_response": {
        "content": [
            {
                "type": "text",
                "text": (
                    "Async agent launched successfully. "
                    "agentId: a1b2c3d4e5f60718 (internal ID - do not mention it)"
                ),
            }
        ]
    },
}


def agent_events(payload):
    return [event for event in normalize(payload) if isinstance(event, AgentEvent)]


def session_events(payload):
    return [event for event in normalize(payload) if isinstance(event, SessionEvent)]


def test_session_start_creates_an_idle_session():
    events = agent_events(REAL_SESSION_START)
    assert len(events) == 1
    assert events[0].agent_id == "session:d1307310-8bf6-43f3-b935-49356082cb89"
    assert events[0].kind.value == "session"
    assert events[0].status is AgentStatus.IDLE


def test_user_prompt_starts_the_session():
    events = agent_events(REAL_USER_PROMPT)
    assert events[0].type == "started"
    assert events[0].status is AgentStatus.WORKING
    assert events[0].detail == "Reply with exactly: ok"


def test_stop_finishes_the_session():
    events = agent_events(REAL_STOP)
    assert events[0].type == "finished"
    assert events[0].status is AgentStatus.FINISHED
    assert events[0].detail == "ok"


def test_stop_reports_background_tasks():
    payload = dict(REAL_STOP)
    payload["background_tasks"] = [
        {
            "id": "task-1",
            "type": "subagent",
            "status": "running",
            "description": "scout the repo",
            "agent_type": "Explore",
        }
    ]
    events = agent_events(payload)
    ids = [event.agent_id for event in events]
    assert "wf:task-1" in ids


def test_subagent_start_spawns_and_starts():
    events = agent_events(REAL_SUBAGENT_START)
    assert [event.type for event in events] == ["spawned", "started"]
    assert events[0].agent_id == "sub:a1b2c3d4e5f60718"
    assert events[0].status is AgentStatus.WORKING
    assert events[0].label == "Explore"


def test_subagent_stop_finishes():
    events = agent_events(REAL_SUBAGENT_STOP)
    assert events[0].type == "finished"
    assert events[0].agent_id == "sub:a1b2c3d4e5f60718"


def test_agent_tool_result_binds_the_spawned_agent():
    events = agent_events(REAL_AGENT_TOOL_RESULT)
    assert len(events) == 1
    assert events[0].type == "spawn_bind"
    assert events[0].agent_id == "sub:a1b2c3d4e5f60718"
    assert events[0].tool_use_id == "call-af5964fa-1d05-49b7-94e6-5d1a7dc6558c"


def test_pre_tool_use_keeps_the_description_as_a_hint():
    payload = {
        "hook_event_name": "PreToolUse",
        "session_id": "s1",
        "tool_name": "Agent",
        "tool_use_id": "call-1",
        "tool_input": {"description": "scout the repo", "subagent_type": "Explore"},
    }
    events = agent_events(payload)
    assert events[0].type == "spawn_hint"
    assert events[0].detail == "scout the repo"
    assert events[0].subagent_type == "Explore"


def test_mcp_tools_become_mcp_agents():
    payload = {
        "hook_event_name": "PreToolUse",
        "session_id": "s1",
        "tool_name": "mcp__chrome-devtools__click",
        "tool_use_id": "call-2",
        "tool_input": {},
    }
    events = agent_events(payload)
    assert events[0].agent_id == "mcp:chrome-devtools"
    assert events[0].kind.value == "mcp"


def test_notification_agent_completed_finishes_the_subagent():
    payload = {
        "hook_event_name": "Notification",
        "notification_type": "agent_completed",
        "agent_id": "a1b2c3d4e5f60718",
        "session_id": "s1",
        "message": "done",
    }
    events = agent_events(payload)
    assert events[0].type == "finished"
    assert events[0].agent_id == "sub:a1b2c3d4e5f60718"


def test_agent_id_prefix_is_normalised():
    assert normalise_agent_id("agent-a1b2c3") == "a1b2c3"
    assert normalise_agent_id("a1b2c3") == "a1b2c3"
    assert normalise_agent_id(None) is None


def test_a_malformed_payload_never_raises():
    for payload in ({}, {"hook_event_name": None}, {"hook_event_name": "Stop"}, None, "nope"):
        assert isinstance(normalize(payload), list)
