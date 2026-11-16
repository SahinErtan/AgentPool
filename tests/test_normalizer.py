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
    # A background subagent is the subagent itself, not a second workflow
    # character for the same agent.
    assert "sub:task-1" in ids
    assert "wf:task-1" not in ids
    sub = next(event for event in events if event.agent_id == "sub:task-1")
    assert sub.description == "scout the repo"


def test_stop_keeps_other_background_work_as_workflows():
    payload = dict(REAL_STOP)
    payload["background_tasks"] = [
        {"id": "bash-1", "type": "local_bash", "status": "running", "description": "npm run dev"},
        {"id": "sub-done", "type": "subagent", "status": "completed", "description": "old"},
    ]
    ids = [event.agent_id for event in agent_events(payload)]
    assert "wf:bash-1" in ids
    assert not any("sub-done" in agent_id for agent_id in ids)


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


def test_mcp_tools_belong_to_their_session():
    payload = {
        "hook_event_name": "PreToolUse",
        "session_id": "s1",
        "tool_name": "mcp__chrome-devtools__click",
        "tool_use_id": "call-2",
        "tool_input": {},
    }
    events = agent_events(payload)
    assert len(events) == 1
    assert events[0].agent_id == "session:s1"
    assert events[0].kind.value == "session"
    assert events[0].type == "note"
    assert events[0].tool_name == "mcp__chrome-devtools__click"
    assert events[0].activity == "chrome-devtools: click"


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


# -- what an agent is doing, in a few words (Sprint 28.4) ---------------


def test_summarize_tool_has_one_line_per_tool_family():
    from agentpool.bridge.normalizer import summarize_tool

    assert summarize_tool("Bash", {"command": "npm test"}) == "Bash: npm test"
    assert summarize_tool("Edit", {"file_path": "/a/b/overlay.ts"}) == "Edit: overlay.ts"
    assert summarize_tool("Read", {"file_path": "/a/b/overlay.ts"}) == "Read: overlay.ts"
    assert summarize_tool("Write", {"file_path": "/a/b/new.md"}) == "Write: new.md"
    assert summarize_tool("NotebookEdit", {"notebook_path": "/n/x.ipynb"}) == "NotebookEdit: x.ipynb"
    assert summarize_tool("Grep", {"pattern": "label"}) == "Grep: label"
    assert summarize_tool("Glob", {"pattern": "**/*.ts"}) == "Glob: **/*.ts"
    assert summarize_tool("WebFetch", {"url": "https://example.com/a/b?q=1"}) == "WebFetch: example.com"
    assert summarize_tool("WebSearch", {"query": "pool sprint"}) == "WebSearch: pool sprint"
    assert summarize_tool("Agent", {"description": "Implement Sprint 21"}) == "Agent: Implement Sprint 21"
    assert summarize_tool("Skill", {"skill": "make-plan"}) == "Skill: make-plan"
    assert summarize_tool("mcp__plugin_playwright_playwright__browser_click", {}) == (
        "playwright: browser_click"
    )
    assert summarize_tool("mcp__chrome-devtools__click", {}) == "chrome-devtools: click"
    assert summarize_tool("TodoWrite", {"todos": []}) == "TodoWrite"


def test_a_newline_in_a_command_never_reaches_the_summary():
    from agentpool.bridge.normalizer import summarize_tool

    assert summarize_tool("Bash", {"command": "npm test\nrm -rf /tmp/x"}) == "Bash: npm test"
    assert summarize_tool("Bash", {"command": "\n\n  make test\n"}) == "Bash: make test"


def test_a_long_command_is_cut_to_sixty_characters():
    from agentpool.bridge.normalizer import summarize_tool

    summary = summarize_tool("Bash", {"command": "echo " + "x" * 500})
    assert summary is not None
    assert len(summary) <= 60
    assert summary.startswith("Bash: echo ")
    assert summary.endswith("...")
    assert "\n" not in summary


def test_a_missing_tool_input_gives_the_tool_name():
    from agentpool.bridge.normalizer import summarize_tool

    assert summarize_tool("Bash", None) == "Bash"
    assert summarize_tool("Edit", {}) == "Edit"
    assert summarize_tool("Bash", "not a dict") == "Bash"
    assert summarize_tool("", {"command": "ls"}) is None
    assert summarize_tool(None, {}) is None


def test_a_file_path_with_no_folder_gives_the_file_name():
    from agentpool.bridge.normalizer import summarize_tool

    assert summarize_tool("Read", {"file_path": "overlay.ts"}) == "Read: overlay.ts"
    assert summarize_tool("Read", {"file_path": "C:\\work\\overlay.ts"}) == "Read: overlay.ts"


def test_the_activity_is_set_when_a_tool_starts_and_not_when_it_ends():
    from agentpool.bridge.normalizer import normalize

    pre = normalize(
        {
            "hook_event_name": "PreToolUse",
            "session_id": "s1",
            "tool_name": "Bash",
            "tool_use_id": "call-1",
            "tool_input": {"command": "npm test"},
        }
    )
    post = normalize(
        {
            "hook_event_name": "PostToolUse",
            "session_id": "s1",
            "tool_name": "Bash",
            "tool_use_id": "call-1",
            "tool_input": {"command": "npm test"},
        }
    )
    assert pre[0].activity == "Bash: npm test"
    assert post[0].activity is None


def test_a_tool_call_inside_a_subagent_is_the_subagents():
    payload = {
        "hook_event_name": "PreToolUse",
        "session_id": "s1",
        "agent_id": "a3a377c8de5ec7777",
        "agent_type": "general-purpose",
        "tool_name": "Read",
        "tool_use_id": "call-3",
        "tool_input": {"file_path": "/repo/frontend/src/scene/names.ts"},
    }
    events = agent_events(payload)
    assert len(events) == 1
    assert events[0].agent_id == "sub:a3a377c8de5ec7777"
    assert events[0].kind.value == "subagent"
    assert events[0].activity == "Read: names.ts"


def test_starting_a_subagent_is_what_the_session_is_doing():
    payload = {
        "hook_event_name": "PreToolUse",
        "session_id": "s1",
        "tool_name": "Agent",
        "tool_use_id": "call-4",
        "tool_input": {"description": "Sprint 28 backend", "subagent_type": "general-purpose"},
    }
    events = agent_events(payload)
    notes = [event for event in events if event.type == "note"]
    assert len(notes) == 1
    assert notes[0].agent_id == "session:s1"
    assert notes[0].activity == "Agent: Sprint 28 backend"
    assert any(event.type == "spawn_hint" for event in events)


def test_a_message_the_harness_put_in_is_not_the_last_prompt():
    payload = {
        "hook_event_name": "UserPromptSubmit",
        "session_id": "s1",
        "prompt": '<agent-message from="a1"> [Subagent hand-back] done',
    }
    started = [event for event in agent_events(payload) if event.type == "started"]
    assert started[0].prompt is None
    payload["prompt"] = "check how far Sprint 28 got"
    started = [event for event in agent_events(payload) if event.type == "started"]
    assert started[0].prompt == "check how far Sprint 28 got"
