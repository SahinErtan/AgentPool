"""The token on the local port.

The backend listens on ``127.0.0.1``, so in principle only the processes on
the machine can reach it. In practice any process on the machine can, and a
browser on another page can send a request to it. A shared token makes the
port a place only AgentPool can use.

The token is optional: with no token the port stays open for the machine,
which is the old behaviour and still the default. Set ``AGENTPOOL_TOKEN``
and every request has to carry it.
"""

from __future__ import annotations

import hmac
from typing import Optional

HEADER = "X-AgentPool-Token"


def token_matches(expected: str, provided: Optional[str]) -> bool:
    """Whether the token that came with the request is the right one.

    An empty expected token means the port is open, so anything is fine.
    The comparison is constant time, so the token cannot be guessed one
    character at a time.
    """
    if not expected:
        return True
    if not provided:
        return False
    return hmac.compare_digest(expected, provided)


def token_from_headers(headers) -> Optional[str]:
    """The token that came with a request, if there was one."""
    if headers is None:
        return None
    try:
        value = headers.get(HEADER)
    except AttributeError:
        return None
    return value.strip() if isinstance(value, str) else None


def token_from_request(request) -> Optional[str]:
    """The token that came with a request, in the header or in the query.

    The query is there for the browser: a WebSocket cannot carry a custom
    header, so the dashboard is opened with the token in the address.
    """
    token = token_from_headers(getattr(request, "headers", None))
    if token:
        return token
    params = getattr(request, "query_params", None)
    if params is None:
        return None
    try:
        value = params.get("token")
    except AttributeError:  # pragma: no cover - defensive
        return None
    return value.strip() if isinstance(value, str) else None


def is_local_host(host: str) -> bool:
    """Whether a host name only means this machine."""
    return host in {"127.0.0.1", "::1", "localhost"}


# The origins a page may have when it is talking to a local backend. A
# request that carries one of these is from the dashboard itself.
LOCAL_ORIGINS = {
    "http://127.0.0.1:38000",
    "http://localhost:38000",
    "http://[::1]:38000",
}


def origin_is_allowed(origin: Optional[str]) -> bool:
    """Whether a page from this origin may write to the backend.

    A browser on another page can send a request to the local backend
    without asking. That is how a web page could put a character that does
    not exist into the pool. A request with no origin at all comes from
    something that is not a browser — the Claude Code hook — and is fine.
    """
    if not origin:
        return True
    if origin in LOCAL_ORIGINS:
        return True
    # A local page on another port is still this machine.
    if origin.startswith("http://127.0.0.1:") or origin.startswith("http://localhost:"):
        return True
    return False


# The content types a browser can send without asking the server first.
# A request with one of these may be a page pretending to be the hook.
SIMPLE_CONTENT_TYPES = {
    "text/plain",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
}


def content_type_is_allowed(content_type: Optional[str]) -> bool:
    """Whether the body may be trusted.

    JSON is what the hook sends. The content types a browser may send
    without a preflight are refused, so a page on the internet cannot
    post a character into the pool.
    """
    if not content_type:
        return True
    value = content_type.split(";")[0].strip().lower()
    if value in SIMPLE_CONTENT_TYPES:
        return False
    return True


