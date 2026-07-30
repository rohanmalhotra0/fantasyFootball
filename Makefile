.PHONY: setup dev data test e2e lint backend frontend

setup:
	cd backend && uv sync --all-extras
	cd frontend && npm install
	cd e2e && npm install

backend:
	cd backend && uv run uvicorn draftengine.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

dev:
	$(MAKE) -j2 backend frontend

data:
	cd backend && uv run python -m draftengine.cli refresh

test:
	cd backend && uv run pytest -q
	cd frontend && npm test -- --run

e2e:
	cd e2e && npx playwright test

lint:
	cd backend && uv run ruff check .
	cd frontend && npx tsc --noEmit
