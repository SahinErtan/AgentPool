# AgentPool - development commands
PYENV_VERSION := 3.11.11
VENV        := $(HOME)/.pyenv/versions/3.11.11/envs/agentpool-env
PORT        := 38000

.PHONY: help venv install dev server frontend build test lab clean

help:
	@echo "make venv      - create the python 3.11 environment"
	@echo "make install   - venv + frontend dependencies"
	@echo "make server    - run the backend on :$(PORT)"
	@echo "make frontend  - run the vite dev server on :5173"
	@echo "make build     - build the frontend into frontend/dist"
	@echo "make test      - run the backend test suite"
	@echo "make lab       - open the animation lab (frontend/?lab)"

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

test:
	$(VENV)/bin/python -m pytest tests -q

lab:
	@echo "open http://127.0.0.1:5173/?lab"

clean:
	rm -rf frontend/dist frontend/node_modules
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
