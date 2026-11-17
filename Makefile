# AgentPool - development commands
PYENV_VERSION := 3.11.11
PORT        := 38000

# The pyenv environment is what this machine uses. A machine without pyenv
# gets a plain .venv next to the project instead, so `make install` works
# for a stranger as well - pyenv is not a requirement, Python 3.11 is.
PYENV_ENV  := $(HOME)/.pyenv/versions/3.11.11/envs/agentpool-env
HAVE_PYENV := $(shell command -v pyenv >/dev/null 2>&1 && pyenv versions --bare 2>/dev/null | grep -qx $(PYENV_VERSION) && echo yes)
VENV       := $(if $(HAVE_PYENV),$(PYENV_ENV),$(CURDIR)/venv)
PY         := $(VENV)/bin/python

# The plugin manifest carries the version, so there is one place to change.
VERSION := $(shell sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' plugin/agentpool/.claude-plugin/plugin.json | head -n1)
STAGE   := dist/agentpool-$(VERSION)
TARBALL := dist/agentpool-$(VERSION).tar.gz

.PHONY: help venv install dev server server-stop frontend build test test-backend test-frontend lab agentpool clean plugin plugin-uninstall release

help:
	@echo "make venv      - create the python 3.11 environment"
	@echo "make install   - venv + frontend dependencies + the frontend build"
	@echo "make server    - run the backend on :$(PORT)"
	@echo "make server-stop - stop the backend that is holding :$(PORT)"
	@echo "make frontend  - run the vite dev server on :5173"
	@echo "make build     - build the frontend into frontend/dist"
	@echo "make test      - run the backend and the frontend test suites"
	@echo "make lab       - open the animation lab (frontend/?lab)"
	@echo "make agentpool - ask the running pool what the agents are doing"
	@echo "make plugin     - install the Claude Code plugin from ./plugin"
	@echo "make release    - pack the plugin and the frontend into dist/"

venv:
	@if [ -n "$(HAVE_PYENV)" ]; then \
		pyenv virtualenv -f $(PYENV_VERSION) agentpool-env; \
	else \
		echo "pyenv with Python $(PYENV_VERSION) is not here, so a plain .venv is made instead."; \
		python3.11 -m venv $(CURDIR)/venv; \
	fi
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -r backend/requirements.txt pytest

# The build belongs here: a fresh clone has to end up with a frontend/dist,
# otherwise the backend serves the API only. The plugin is not installed
# here — that writes to the global Claude config and stays a deliberate step.
install: venv
	cd frontend && npm install --ignore-scripts
	$(MAKE) build

# The plugin starts the backend by itself, so the port is often already
# taken. Saying so is friendlier than letting the socket fail.
server:
	@if curl -s -m 1 http://127.0.0.1:$(PORT)/api/health >/dev/null 2>&1; then \
		echo "AgentPool is already running on http://127.0.0.1:$(PORT)."; \
		echo "The dashboard is there. Stop that one first with: make server-stop"; \
		exit 1; \
	fi
	$(PY) backend/run.py

# The backend that is holding the port, whoever started it.
server-stop:
	@pid=$$(ss -ltnp 2>/dev/null | grep ':$(PORT) ' | grep -o 'pid=[0-9]*' | head -n1 | cut -d= -f2); \
	if [ -z "$$pid" ]; then \
		echo "nothing is listening on :$(PORT)"; \
		exit 0; \
	fi; \
	echo "stopping the AgentPool backend (pid $$pid)"; \
	kill "$$pid" 2>/dev/null || true; \
	for i in 1 2 3 4 5 6 7 8 9 10; do \
		kill -0 "$$pid" 2>/dev/null || break; \
		sleep 0.3; \
	done; \
	if kill -0 "$$pid" 2>/dev/null; then kill -9 "$$pid" 2>/dev/null || true; fi; \
	echo "the port is free again"

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

test: test-backend test-frontend

test-backend:
	$(PY) -m pytest tests -q

test-frontend:
	cd frontend && npm test

lab:
	@echo "open http://127.0.0.1:5173/?lab"

# Ask the running pool what the agents are doing. The arguments go straight
# through: `make agentpool ARGS="--agent session:abc"`.
agentpool:
	@PYTHONPATH=backend $(PY) -m agentpool.cli $(ARGS)

# The plugin is installed from a local marketplace, so the plugin always
# matches the code in this working copy.
plugin: build
	@mkdir -p $$HOME/.config/agentpool
	@echo "$(CURDIR)" > $$HOME/.config/agentpool/root
	@claude plugin marketplace remove agentpool-local >/dev/null 2>&1 || true
	@claude plugin marketplace add $(CURDIR)/plugin
	@claude plugin install agentpool@agentpool-local
	@echo ""
	@echo "AgentPool is installed. The dashboard comes up on http://127.0.0.1:$(PORT)"
	@echo "as soon as a Claude Code session starts."

plugin-uninstall:
	@claude plugin uninstall agentpool@agentpool-local || true
	@claude plugin marketplace remove agentpool-local || true

clean:
	rm -rf frontend/dist frontend/node_modules dist
	find . -name __pycache__ -type d -prune -exec rm -rf {} +

# The release is a tarball of everything a person needs to run the pool:
# the backend, the plugin, the built frontend and the documents. The build
# runs first, so the tarball always carries a frontend that matches the
# source. It is not installed anywhere - unpacking it and running
# `make install` there is the whole installation.
release: build
	@rm -rf $(STAGE) $(TARBALL)
	@mkdir -p $(STAGE)/frontend
	@cp -R backend plugin docs tests $(STAGE)/
	@cp -R frontend/src frontend/test $(STAGE)/frontend/
	@cp frontend/index.html frontend/package.json frontend/package-lock.json \
		frontend/tsconfig.json frontend/vite.config.ts $(STAGE)/frontend/
	@cp -R frontend/dist $(STAGE)/frontend/dist
	@cp Makefile LICENSE README.md CLAUDE.md $(STAGE)/
	@find $(STAGE) -name '__pycache__' -type d -prune -exec rm -rf {} +
	@find $(STAGE) -name '*.pyc' -delete
	@rm -rf $(STAGE)/frontend/test/.build $(STAGE)/frontend/test/.build-*
	@tar -czf $(TARBALL) -C dist agentpool-$(VERSION)
	@rm -rf $(STAGE)
	@echo ""
	@echo "AgentPool $(VERSION) is packed:"
	@echo "  $(TARBALL)"
	@echo ""
	@echo "Unpack it, then run 'make install' and 'make plugin' inside it."
