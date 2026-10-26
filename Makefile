GO ?= go

.PHONY: build test vet fmt run seed demo-up demo-down demo-reset web web-demo bench

build:
	$(GO) build ./...

vet:
	$(GO) vet ./...

test:
	$(GO) test ./...

fmt:
	gofmt -w cmd internal services tests

run: ## API with in-memory demo storage (no PostgreSQL needed)
	KAIRO_DEMO_MODE=true KAIRO_SEED_DEMO=true $(GO) run ./cmd/kairo-api

demo-up:
	docker compose -f deploy/docker-compose.yml up --build

demo-down:
	docker compose -f deploy/docker-compose.yml down

demo-reset:
	docker compose -f deploy/docker-compose.yml down -v

web:
	cd web && npm install && VITE_DATA_MODE=api VITE_API_BASE_URL=http://localhost:8080 npm run dev

web-demo:
	cd web && npm install && npm run dev

bench: ## run the load harness against a running API (set KAIRO_API_KEY)
	$(GO) run ./tests/load -addr http://localhost:8080 -api-key $$KAIRO_API_KEY
