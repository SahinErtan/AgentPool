# AgentPool - development commands
PYENV_VERSION := 3.11.11
VENV        := $(HOME)/.pyenv/versions/3.11.11/envs/agentpool-env
PORT        := 38000

.PHONY: help venv install dev server frontend build test test-backend test-frontend lab clean plugin plugin-uninstall

help:
	@echo "make venv      - create the python 3.11 environment"
	@echo "make install   - venv + frontend dependencies"
	@echo "make server    - run the backend on :$(PORT)"
	@echo "make frontend  - run the vite dev server on :5173"
	@echo "make build     - build the frontend into frontend/dist"
	@echo "make test      - run the backend and the frontend test suites"
	@echo "make lab       - open the animation lab (frontend/?lab)"
	@echo "make plugin     - install the Claude Code plugin from ./plugin"

venv:
	pyenv virtualenv -f $(PYENV_VERSION) agentpool-env
	$(VENV)/bin/pip install --upgrade pip
	$(VENV)/bin/pip install -r backend/requirements.txt pytest

install: venv
	cd frontend && npm install --ignore-scripts

server:
	$(VENV)/bin/python backend/run.py

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

test: test-backend test-frontend

test-backend:
	$(VENV)/bin/python -m pytest tests -q

test-frontend:
	cd frontend && npm test

lab:
	@echo "open http://127.0.0.1:5173/?lab"

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
	rm -rf frontend/dist frontend/node_modules
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
