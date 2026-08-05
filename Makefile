.PHONY: dev dev-backend dev-frontend build build-frontend build-backend clean tools

# ---- Development ----

dev:
	@echo "Starting Go backend and Vite dev server..."
	start /B npx --prefix web vite --host
	air -- --port 8080

dev-backend:
	go run ./cmd/server/

dev-frontend:
	npx --prefix web vite --host

# ---- Build ----

build: build-frontend build-backend

build-frontend:
	npx --prefix web npm ci
	npx --prefix web npm run build

build-backend:
	xcopy /E /I /Y /Q web\dist cmd\server\webdist\
	go build -o bin\tvapp.exe ./cmd/server/

# ---- Clean ----

clean:
	if exist web\dist rmdir /S /Q web\dist
	if exist bin rmdir /S /Q bin
	if exist tvapp.db del /Q tvapp.db

# ---- Tools ----

tools:
	go install github.com/air-verse/air@latest
