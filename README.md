# tvapp

Open-source, lightweight media server and player for live television — IPTV (M3U/XMLTV) and HDHomeRun hardware tuners.

## Quick Start

```bash
# Install Go tools
make tools

# Development (two terminals)
make dev-frontend   # Vite on :5173
make dev-backend    # Go API on :8080

# Production build
make build
./bin/tvapp
```

## Architecture

```
tvapp/
├── cmd/server/       # Go entry point, embeds web/dist
├── internal/
│   ├── api/          # Chi HTTP router & handlers
│   ├── db/           # SQLite schema + migrations
│   ├── epg/          # XMLTV guide parser
│   ├── hdhomerun/    # Tuner discovery & management
│   └── iptv/         # M3U playlist parser
├── web/              # Vite + React + Tailwind CSS
│   └── src/
│       ├── components/  # Player, EPG grid, channel list
│       ├── hooks/       # Custom React hooks
│       └── lib/         # HLS wrapper, API client
├── go.mod
└── Makefile
```

## API Endpoints

| Method | Path                | Description            |
|--------|---------------------|------------------------|
| GET    | `/health`           | Health check           |
| GET    | `/api/devices`      | Discover HDHomeRun     |
| POST   | `/api/playlists/parse` | Parse M3U from URL  |

## License

MIT
