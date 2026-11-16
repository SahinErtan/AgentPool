"""The registry: the agent lifecycle and the identity joins."""

from __future__ import annotations

from agentpool.bridge.events import AgentEvent, AgentKind, AgentStatus
from agentpool.bridge.registry import AgentRegistry


def make_registry(**kwargs):
    """A registry with a frozen clock so the sweepers can be tested."""
    if "clock" not in kwargs:
        now = [1000.0]

        def clock():
            return now[0]

        kwargs["clock"] = clock
    return AgentRegistry(**kwargs)


def spawn(registry, agent_id="sub:a1", status=AgentStatus.WORKING, **kwargs):
    return registry.apply(
        AgentEvent.new(
            type="spawned",
            agent_id=agent_id,
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=status,
            label=kwargs.pop("label", "Explore"),
            **kwargs,
        )
    )


def test_a_spawned_agent_exists_and_works():
    registry = make_registry()
    spawn(registry)
    agent = registry.get("sub:a1")
    assert agent is not None
    assert agent.status is AgentStatus.WORKING
    assert agent.started_at is not None


def test_a_description_that_arrives_late_is_merged_in():
    registry = make_registry()
    spawn(registry, detail=None)

    # The Agent tool was called: the description is known, the id is not.
    registry.apply(
        AgentEvent.new(
            type="spawn_hint",
            agent_id="sub:pending:toolu_1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.IDLE,
            label="Explore",
            detail="scout the repo",
            tool_use_id="toolu_1",
            subagent_type="Explore",
        )
    )
    # The agent already exists and the result now names it.
    registry.apply(
        AgentEvent.new(
            type="spawn_bind",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.WORKING,
            label="Explore",
            tool_use_id="toolu_1",
        )
    )
    agent = registry.get("sub:a1")
    assert agent.detail == "scout the repo"
    assert agent.tool_use_id == "toolu_1"


def test_finishing_then_idle():
    registry = make_registry()
    spawn(registry)
    registry.apply(
        AgentEvent.new(
            type="finished",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.FINISHED,
            label="Explore",
        )
    )
    assert registry.get("sub:a1").status is AgentStatus.FINISHED


def test_removal_is_deferred_so_the_character_can_walk_out():
    registry = make_registry(exit_grace_s=15.0)
    spawn(registry)
    registry.apply(
        AgentEvent.new(
            type="removed",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.REMOVED,
            label="Explore",
        )
    )
    agent = registry.get("sub:a1")
    assert agent is not None, "the agent must survive the removal long enough to leave"
    assert agent.status is AgentStatus.LEAVING
    assert agent.leaving_deadline is not None


def test_an_acknowledged_exit_removes_the_agent():
    registry = make_registry()
    spawn(registry)
    registry.apply(
        AgentEvent.new(
            type="removed",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.REMOVED,
            label="Explore",
        )
    )
    assert registry.acknowledge_exit("sub:a1") is True
    assert registry.get("sub:a1") is None


def test_the_sweeper_reaps_an_expired_exit():
    registry = make_registry(exit_grace_s=15.0)
    spawn(registry)
    registry.apply(
        AgentEvent.new(
            type="removed",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.REMOVED,
            label="Explore",
        )
    )
    registry.sweep(now=1000.0 + 16.0)
    assert registry.get("sub:a1") is None


def test_a_stalled_agent_goes_idle_instead_of_freezing_in_the_water():
    registry = make_registry(idle_ttl_s=90.0)
    spawn(registry, detail="looking around the repo")
    registry.sweep(now=1000.0 + 91.0)
    agent = registry.get("sub:a1")
    assert agent.status is AgentStatus.IDLE
    # The description of the agent is not touched: it is what tells two
    # agents of the same kind apart in the list.
    assert agent.detail == "looking around the repo"


def test_an_idle_session_is_eventually_reaped():
    registry = make_registry(session_ttl_s=900.0)
    registry.apply(
        AgentEvent.new(
            type="spawned",
            agent_id="session:s1",
            kind=AgentKind.SESSION,
            session_id="s1",
            parent_id=None,
            status=AgentStatus.IDLE,
            label="main",
        )
    )
    registry.sweep(now=1000.0 + 901.0)
    agent = registry.get("session:s1")
    assert agent.status is AgentStatus.LEAVING


def test_the_event_ring_buffer_is_bounded():
    registry = make_registry()
    spawn(registry)
    for _ in range(80):
        registry.apply(
            AgentEvent.new(
                type="note",
                agent_id="sub:a1",
                kind=AgentKind.SUBAGENT,
                session_id="s1",
                parent_id="session:s1",
                status=AgentStatus.WORKING,
                label="Explore",
                detail="Read",
                tool_name="Read",
            )
        )
    agent = registry.get("sub:a1")
    assert len(agent.last_events) == 50
    assert agent.event_count == 81


def test_the_agent_carries_its_last_events_to_the_browser():
    """The inspector shows what the agent did, so the events travel with it."""
    registry = make_registry()
    spawn(registry)
    registry.apply(
        AgentEvent.new(
            type="note",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.WORKING,
            label="Explore",
            detail="Read",
            tool_name="Read",
        )
    )

    payload = registry.get("sub:a1").to_dict()

    assert len(payload["events"]) == 2
    assert payload["events"][-1]["tool"] == "Read"
    assert payload["events"][-1]["detail"] == "Read"


def test_a_finished_agent_can_walk_out_of_the_scene():
    """A finished subagent climbs out and leaves like everybody else."""
    registry = make_registry()
    spawn(registry)
    registry.apply(
        AgentEvent.new(
            type="finished",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.FINISHED,
            label="Explore",
        )
    )
    assert registry.get("sub:a1").status is AgentStatus.FINISHED

    assert registry.acknowledge_exit("sub:a1") is True
    assert registry.get("sub:a1") is None


def test_an_agent_that_is_still_in_the_pool_cannot_walk_out():
    """A character that waits at the gate is still part of the scene."""
    registry = make_registry()
    spawn(registry, status=AgentStatus.IDLE)

    assert registry.acknowledge_exit("sub:a1") is False
    assert registry.get("sub:a1") is not None


def test_a_leaving_agent_can_walk_out_of_the_scene():
    registry = make_registry()
    spawn(registry)
    registry.apply(
        AgentEvent.new(
            type="removed",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.REMOVED,
            label="Explore",
        )
    )

    assert registry.acknowledge_exit("sub:a1") is True
    assert registry.get("sub:a1") is None


# -- the name a session keeps (Sprint 28.1) ------------------------------


def _session_event(event_type, label=None, status=AgentStatus.WORKING, **kwargs):
    return AgentEvent.new(
        type=event_type,
        agent_id="session:s1",
        kind=AgentKind.SESSION,
        session_id="s1",
        parent_id=None,
        status=status,
        label=label,
        **kwargs,
    )


def test_a_session_keeps_the_name_it_has_from_the_disk_through_the_hooks():
    from agentpool.bridge.normalizer import normalize

    registry = make_registry()
    registry.apply(
        _session_event("spawned", label="pool-scene-3d-sprint", status=AgentStatus.IDLE)
    )
    hook_payloads = [
        {"hook_event_name": "UserPromptSubmit", "session_id": "s1", "prompt": "go"},
        {
            "hook_event_name": "PreToolUse",
            "session_id": "s1",
            "tool_name": "Bash",
            "tool_use_id": "call-1",
            "tool_input": {"command": "npm test"},
        },
        {"hook_event_name": "Stop", "session_id": "s1", "background_tasks": []},
    ]
    for payload in hook_payloads:
        for event in normalize(payload):
            if isinstance(event, AgentEvent):
                registry.apply(event)

    assert registry.get("session:s1").label == "pool-scene-3d-sprint"


def test_a_session_that_only_ever_had_hooks_is_called_main():
    from agentpool.bridge.normalizer import normalize

    registry = make_registry()
    for payload in [
        {"hook_event_name": "SessionStart", "session_id": "s1", "source": "startup"},
        {"hook_event_name": "UserPromptSubmit", "session_id": "s1", "prompt": "go"},
        {"hook_event_name": "Stop", "session_id": "s1", "background_tasks": []},
    ]:
        for event in normalize(payload):
            if hasattr(event, "agent_id"):
                registry.apply(event)

    assert registry.get("session:s1").label == "main"


def test_a_real_name_is_never_replaced_by_a_placeholder():
    registry = make_registry()
    registry.apply(_session_event("spawned", label="pool-sprint", status=AgentStatus.IDLE))
    registry.apply(_session_event("started", label="main"))
    registry.apply(_session_event("started", label="session"))
    registry.apply(_session_event("started", label=""))

    assert registry.get("session:s1").label == "pool-sprint"


def test_a_real_name_replaces_an_earlier_placeholder():
    registry = make_registry()
    registry.apply(_session_event("spawned", label=None, status=AgentStatus.IDLE))
    assert registry.get("session:s1").label == "main"

    registry.apply(_session_event("started", label="pool-sprint"))
    assert registry.get("session:s1").label == "pool-sprint"


def test_an_event_without_a_label_gets_the_placeholder_for_its_kind():
    registry = make_registry()
    registry.apply(_session_event("spawned", label=None, status=AgentStatus.IDLE))
    assert registry.get("session:s1").label == "main"

    spawn(registry, label=None)
    assert registry.get("sub:a1").label == "subagent"


def test_is_placeholder_knows_the_placeholders_and_nothing_else():
    from agentpool.bridge.registry import is_placeholder

    for label in [None, "", "  ", "main", "session", "subagent", "task"]:
        assert is_placeholder(label), label
    for label in ["pool-sprint", "Explore", "main menu", "task runner"]:
        assert not is_placeholder(label), label


# -- the project an agent works in (Sprint 28.2) -------------------------


def test_a_hook_event_cwd_reaches_the_agent():
    from agentpool.bridge.normalizer import normalize

    registry = make_registry()
    for event in normalize(
        {
            "hook_event_name": "UserPromptSubmit",
            "session_id": "s1",
            "cwd": "/home/alice/work/AgentPool",
            "prompt": "go",
        }
    ):
        if isinstance(event, AgentEvent):
            registry.apply(event)

    state = registry.get("session:s1")
    assert state.cwd == "/home/alice/work/AgentPool"
    assert registry.payload(state)["project"] == "AgentPool"


def test_a_subagent_without_a_folder_reports_its_parents_project():
    registry = make_registry()
    registry.apply(
        _session_event(
            "spawned",
            label="pool-sprint",
            status=AgentStatus.IDLE,
            cwd="/home/alice/work/AgentPool/",
        )
    )
    spawn(registry)  # the subagent event carries no cwd

    payload = registry.payload(registry.get("sub:a1"))
    assert payload["cwd"] == "/home/alice/work/AgentPool/"
    assert payload["project"] == "AgentPool"


def test_a_subagent_with_its_own_folder_keeps_it():
    registry = make_registry()
    registry.apply(
        _session_event("spawned", label="pool-sprint", status=AgentStatus.IDLE, cwd="/a/Main")
    )
    spawn(registry, cwd="/a/other/Elsewhere")

    payload = registry.payload(registry.get("sub:a1"))
    assert payload["project"] == "Elsewhere"


def test_a_workflow_without_a_folder_reports_its_parents_project():
    registry = make_registry()
    registry.apply(
        _session_event("spawned", label="pool-sprint", status=AgentStatus.IDLE, cwd="/a/AgentPool")
    )
    registry.apply(
        AgentEvent.new(
            type="started",
            agent_id="wf:t1",
            kind=AgentKind.WORKFLOW,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.WORKING,
            label="task",
        )
    )

    assert registry.payload(registry.get("wf:t1"))["project"] == "AgentPool"


def test_a_session_without_a_folder_has_no_project():
    registry = make_registry()
    registry.apply(_session_event("spawned", label="main", status=AgentStatus.IDLE))

    payload = registry.payload(registry.get("session:s1"))
    assert payload["cwd"] is None
    assert payload["project"] is None


def test_project_is_the_last_folder_for_either_separator():
    from agentpool.bridge.registry import project_of

    assert project_of("/home/alice/code/tools/AgentPool") == "AgentPool"
    assert project_of("/home/alice/AgentPool/") == "AgentPool"
    assert project_of("C:\\Users\\alice\\Web.App") == "Web.App"
    assert project_of("/") is None
    assert project_of("") is None
    assert project_of(None) is None


# -- the name of each agent (Sprint 28.3) --------------------------------


def _apply_all(registry, payloads):
    from agentpool.bridge.normalizer import normalize

    for payload in payloads:
        for event in normalize(payload):
            if isinstance(event, AgentEvent):
                registry.apply(event)


def _spawn_by_the_agent_tool(registry, description="Implement Sprint 21", subagent_type="Explore"):
    """The three hook events of one Agent tool call, in the order Claude sends them."""
    _apply_all(
        registry,
        [
            {
                "hook_event_name": "PreToolUse",
                "session_id": "s1",
                "cwd": "/home/alice/work/pool-sprint",
                "tool_name": "Agent",
                "tool_use_id": "call-1",
                "tool_input": {"description": description, "subagent_type": subagent_type},
            },
            {
                "hook_event_name": "SubagentStart",
                "session_id": "s1",
                "agent_id": "a1b2c3d4e5f6",
                "agent_type": subagent_type,
            },
            {
                "hook_event_name": "PostToolUse",
                "session_id": "s1",
                "tool_name": "Agent",
                "tool_use_id": "call-1",
                "tool_input": {"description": description, "subagent_type": subagent_type},
                "tool_response": "agentId: a1b2c3d4e5f6 done",
            },
        ],
    )


def test_a_session_is_named_by_its_name_then_its_project_then_its_id():
    registry = make_registry()
    registry.apply(_session_event("spawned", label="pool-sprint", status=AgentStatus.IDLE,
                                  cwd="/a/AgentPool"))
    assert registry.payload(registry.get("session:s1"))["name"] == "pool-sprint"

    registry = make_registry()
    registry.apply(_session_event("spawned", label="main", status=AgentStatus.IDLE,
                                  cwd="/a/AgentPool"))
    assert registry.payload(registry.get("session:s1"))["name"] == "AgentPool"

    registry = make_registry()
    registry.apply(_session_event("spawned", label="main", status=AgentStatus.IDLE))
    assert registry.payload(registry.get("session:s1"))["name"] == "session s1"


def test_a_session_id_is_cut_to_four_characters_in_its_fallback_name():
    registry = make_registry()
    registry.apply(
        AgentEvent.new(
            type="spawned",
            agent_id="session:d1307310-8bf6",
            kind=AgentKind.SESSION,
            session_id="d1307310-8bf6",
            parent_id=None,
            status=AgentStatus.IDLE,
            label=None,
        )
    )
    assert registry.payload(registry.get("session:d1307310-8bf6"))["name"] == "session d130"


def test_a_subagent_is_named_by_its_description_then_its_type_then_subagent():
    registry = make_registry()
    _spawn_by_the_agent_tool(registry, description="Implement Sprint 21", subagent_type="Explore")
    assert registry.payload(registry.get("sub:a1b2c3d4e5f6"))["name"] == "Implement Sprint 21"

    registry = make_registry()
    _spawn_by_the_agent_tool(registry, description="", subagent_type="Explore")
    assert registry.payload(registry.get("sub:a1b2c3d4e5f6"))["name"] == "Explore"

    registry = make_registry()
    registry.apply(
        AgentEvent.new(
            type="spawned",
            agent_id="sub:x1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.WORKING,
            label=None,
        )
    )
    assert registry.payload(registry.get("sub:x1"))["name"] == "subagent"


def test_a_workflow_is_named_by_its_description_then_its_label_then_task():
    registry = make_registry()
    registry.apply(
        AgentEvent.new(
            type="started", agent_id="wf:t1", kind=AgentKind.WORKFLOW, session_id="s1",
            parent_id="session:s1", status=AgentStatus.WORKING, label="shell",
            description="Run the tests",
        )
    )
    assert registry.payload(registry.get("wf:t1"))["name"] == "Run the tests"

    registry.apply(
        AgentEvent.new(
            type="started", agent_id="wf:t2", kind=AgentKind.WORKFLOW, session_id="s1",
            parent_id="session:s1", status=AgentStatus.WORKING, label="shell",
        )
    )
    assert registry.payload(registry.get("wf:t2"))["name"] == "shell"

    registry.apply(
        AgentEvent.new(
            type="started", agent_id="wf:t3", kind=AgentKind.WORKFLOW, session_id="s1",
            parent_id="session:s1", status=AgentStatus.WORKING, label=None,
        )
    )
    assert registry.payload(registry.get("wf:t3"))["name"] == "task"


def test_a_name_is_tidied_of_its_whitespace_but_not_cut():
    registry = make_registry()
    long_description = "Implement   Sprint 21\n  with the\tbackend steps and the frontend steps too"
    _spawn_by_the_agent_tool(registry, description=long_description)

    name = registry.payload(registry.get("sub:a1b2c3d4e5f6"))["name"]
    assert name == "Implement Sprint 21 with the backend steps and the frontend steps too"
    assert registry.payload(registry.get("sub:a1b2c3d4e5f6"))["description"] == long_description


def test_a_later_tool_call_does_not_rename_a_subagent():
    registry = make_registry()
    _spawn_by_the_agent_tool(registry, description="Implement Sprint 21")
    before = registry.payload(registry.get("sub:a1b2c3d4e5f6"))

    _apply_all(
        registry,
        [
            {
                "hook_event_name": "PreToolUse",
                "session_id": "s1",
                "tool_name": "Bash",
                "tool_use_id": "call-9",
                "tool_input": {"command": "npm test"},
            }
        ],
    )
    after = registry.payload(registry.get("sub:a1b2c3d4e5f6"))
    assert after["description"] == before["description"] == "Implement Sprint 21"
    assert after["name"] == before["name"] == "Implement Sprint 21"


def test_the_prompt_is_kept_for_the_session():
    registry = make_registry()
    _apply_all(
        registry,
        [{"hook_event_name": "UserPromptSubmit", "session_id": "s1", "prompt": "check Sprint 21"}],
    )
    assert registry.payload(registry.get("session:s1"))["prompt"] == "check Sprint 21"


def test_the_activity_is_kept_until_the_turn_ends():
    from agentpool.bridge.normalizer import normalize

    registry = make_registry()
    registry.apply(_session_event("spawned", label="pool-sprint", status=AgentStatus.IDLE))

    def tool(event, tool_name, command):
        for item in normalize(
            {
                "hook_event_name": event,
                "session_id": "s1",
                "tool_name": tool_name,
                "tool_use_id": "call-x",
                "tool_input": {"command": command},
            }
        ):
            if isinstance(item, AgentEvent):
                registry.apply(item)

    tool("PreToolUse", "Bash", "npm test")
    assert registry.get("session:s1").activity == "Bash: npm test"

    # The end of a tool keeps the activity of the tool that is still there.
    tool("PostToolUse", "Bash", "npm test")
    assert registry.get("session:s1").activity == "Bash: npm test"

    tool("PreToolUse", "Edit", "")
    assert registry.get("session:s1").activity == "Edit"

    for item in normalize({"hook_event_name": "Stop", "session_id": "s1", "background_tasks": []}):
        if isinstance(item, AgentEvent):
            registry.apply(item)
    assert registry.get("session:s1").activity is None
    assert registry.payload(registry.get("session:s1"))["activity"] is None


# -- MCP servers are not characters (Sprint 28.5) ------------------------


def test_an_mcp_call_marks_its_session_working_with_its_activity():
    from agentpool.bridge.normalizer import normalize

    registry = make_registry()
    registry.apply(_session_event("spawned", label="pool-sprint", status=AgentStatus.IDLE))
    for item in normalize(
        {
            "hook_event_name": "PreToolUse",
            "session_id": "s1",
            "tool_name": "mcp__chrome-devtools__click",
            "tool_use_id": "call-m",
            "tool_input": {"uid": "3_4"},
        }
    ):
        if isinstance(item, AgentEvent):
            registry.apply(item)

    state = registry.get("session:s1")
    assert state.status is AgentStatus.WORKING
    assert state.activity == "chrome-devtools: click"
    assert state.label == "pool-sprint"
    assert [s.kind for s in registry.snapshot()] == [AgentKind.SESSION]


def test_an_mcp_record_from_an_old_journal_creates_no_agent():
    registry = make_registry()
    registry.apply(
        AgentEvent.new(
            type="started",
            agent_id="mcp:chrome-devtools",
            kind=AgentKind.MCP,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.WORKING,
            label="chrome-devtools",
            tool_name="mcp__chrome-devtools__click",
        )
    )
    assert registry.get("mcp:chrome-devtools") is None
    assert len(registry) == 0


def test_a_plugin_server_is_named_by_its_short_name():
    from agentpool.bridge.normalizer import summarize_tool

    assert summarize_tool("mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_snapshot", {}) == (
        "chrome-devtools: take_snapshot"
    )
    assert summarize_tool("mcp__plugin_playwright_playwright__browser_wait_for", {}) == (
        "playwright: browser_wait_for"
    )


def test_a_tool_note_never_brings_back_a_subagent_that_is_gone():
    registry = AgentRegistry()
    changed = registry.apply(
        AgentEvent.new(
            type="note",
            agent_id="sub:gone",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.WORKING,
            tool_name="Read",
        )
    )
    assert changed == []
    assert registry.get("sub:gone") is None


def test_the_project_is_where_the_session_started_not_where_it_moved():
    registry = AgentRegistry()

    def note(cwd, source="hook"):
        return AgentEvent.new(
            type="note",
            agent_id="session:s1",
            kind=AgentKind.SESSION,
            session_id="s1",
            parent_id=None,
            status=AgentStatus.WORKING,
            cwd=cwd,
            source=source,
        )

    registry.apply(note("/repo/AgentPool"))
    registry.apply(note("/repo/AgentPool/frontend/src"))
    assert registry.get("session:s1").cwd == "/repo/AgentPool"
    # The session file on the disk is the authority.
    registry.apply(note("/repo/Other", source="reconcile"))
    assert registry.get("session:s1").cwd == "/repo/Other"


def test_a_subagent_still_names_its_session_after_the_session_has_gone():
    registry = AgentRegistry(exit_grace_s=0.0)
    registry.apply(
        AgentEvent.new(
            type="spawned",
            agent_id="session:s1",
            kind=AgentKind.SESSION,
            session_id="s1",
            parent_id=None,
            status=AgentStatus.IDLE,
            label="mediaorganizer-77",
            source="reconcile",
        )
    )
    registry.apply(
        AgentEvent.new(
            type="spawned",
            agent_id="sub:a1",
            kind=AgentKind.SUBAGENT,
            session_id="s1",
            parent_id="session:s1",
            status=AgentStatus.WORKING,
            description="Olguları doğrula",
        )
    )
    registry.apply(
        AgentEvent.new(
            type="finished",
            agent_id="session:s1",
            kind=AgentKind.SESSION,
            session_id="s1",
            parent_id=None,
            status=AgentStatus.FINISHED,
        )
    )
    registry.sweep()
    assert registry.get("session:s1") is None
    payload = registry.payload(registry.get("sub:a1"))
    assert payload["session_name"] == "mediaorganizer-77"
