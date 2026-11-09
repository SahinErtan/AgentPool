"""The architecture guard.

The bridge is the reusable half of AgentPool: a future stadium or office
project must be able to copy it verbatim. This test makes that a *checked
property* rather than a promise — the bridge may not mention the scene it
feeds, nor import from it.

Only **code** is checked: comments and docstrings are free to explain that
the bridge is scene agnostic, which is the whole point of the contract.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

BRIDGE = Path(__file__).resolve().parents[1] / "backend" / "agentpool" / "bridge"

# Vocabulary that belongs to a scene, not to the bridge.
FORBIDDEN = {
    "pool",
    "stadium",
    "lounger",
    "lane",
    "swim",
    "gate",
    "ladder",
    "water",
    "caustics",
}


def _split_identifier(name: str) -> set[str]:
    """``agentPoolGate`` and ``agent_pool_gate`` both yield ``gate``."""
    parts = re.split(r"[^A-Za-z0-9]+", name)
    out: set[str] = set()
    for part in parts:
        out.update(re.findall(r"[A-Z]+(?![a-z])|[A-Z][a-z]*|[a-z]+|\d+", part))
    return {part.lower() for part in out}


def _code_tokens(path: Path) -> tuple[set[str], list[str]]:
    """The identifiers and the non-docstring strings of a module."""
    tree = ast.parse(path.read_text(encoding="utf-8"))

    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", [])
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                if isinstance(body[0].value.value, str):
                    docstrings.add(id(body[0].value))

    identifiers: set[str] = set()
    strings: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            identifiers.update(_split_identifier(node.id))
        elif isinstance(node, ast.Attribute):
            identifiers.update(_split_identifier(node.attr))
        elif isinstance(node, ast.arg):
            identifiers.update(_split_identifier(node.arg))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            identifiers.update(_split_identifier(node.name))
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            if id(node) not in docstrings:
                strings.append(node.value)
    return identifiers, strings


def test_the_bridge_does_not_use_any_scene_vocabulary():
    offenders = []
    for path in sorted(BRIDGE.glob("*.py")):
        identifiers, strings = _code_tokens(path)
        hits = sorted(FORBIDDEN & identifiers)
        if hits:
            offenders.append(f"{path.name}: {', '.join(hits)}")
        for text in strings:
            lowered = text.lower()
            for word in FORBIDDEN:
                # Word boundaries matter: the logger name "agentpool.reconcile"
                # is not a scene reference.
                if re.search(rf"\b{word}\b", lowered):
                    offenders.append(f"{path.name}: string {text!r}")
    assert not offenders, "the bridge must stay scene agnostic: " + "; ".join(offenders)


def test_the_bridge_does_not_import_the_scenes():
    offenders = []
    for path in sorted(BRIDGE.glob("*.py")):
        source = path.read_text(encoding="utf-8")
        if (
            "from ..scenes" in source
            or "import scenes" in source
            or "from agentpool.scenes" in source
        ):
            offenders.append(path.name)
    assert not offenders, "the bridge must not import a scene: " + ", ".join(offenders)


def test_the_bridge_does_not_import_the_web_layer():
    offenders = []
    for path in sorted(BRIDGE.glob("*.py")):
        source = path.read_text(encoding="utf-8")
        if "fastapi" in source or "starlette" in source or "uvicorn" in source:
            offenders.append(path.name)
    assert not offenders, "the bridge must not know about the transport: " + ", ".join(offenders)
