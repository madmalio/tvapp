# tvapp — Agent Instructions

## Build

```powershell
# Backend
go build -o bin\tvapp.exe .\cmd\server\

# Frontend (from web/)
cd web
.\node_modules\.bin\vite build
cd ..

# Full build (frontend + copy + backend)
.\node_modules\.bin\vite build
Copy-Item -Path "web\dist\*" -Destination "cmd\server\webdist\" -Recurse -Force
go build -o bin\tvapp.exe .\cmd\server\
```

## Run

> **Note to Agents:** DO NOT run the dev servers or start commands in the background. The user will run these commands manually in their own terminals to maintain control of the development environment.
>
> **Important Docker Note**: `tvapp` currently starts MediaMTX automatically as a child process. When building the `docker-compose` stack in the future, we MUST revert this behavior in `cmd/server/main.go` so that `tvapp` and MediaMTX run in separate isolated containers.

```powershell
# Binary (uses embedded frontend)
.\bin\tvapp.exe

# Dev (no embedded frontend — uses Vite dev server on :5173 proxied to :8080)
go run .\cmd\server\
# In another terminal:
npx --prefix web vite
```

## Linux Server Deployment

To deploy the application to the user's Linux server, compile a Linux binary and upload it via `scp`:

```powershell
# 1. Build the Linux binary
$env:GOOS="linux"; $env:GOARCH="amd64"; go build -o bin\tvapp-linux .\cmd\server\

# 2. Upload to server
scp .\bin\tvapp-linux mark@192.168.4.143:~/tvapp/tvapp

# 3. Note: The user runs MediaMTX on the server and will restart tvapp manually.
```

## Frontend Dev

```powershell
cd web
.\node_modules\.bin\vite  # Dev server with API proxy to localhost:8080
```

## Type Check

```powershell
cd web
npx tsc --noEmit
```

## Project Structure

```
tvapp/
├── cmd/server/           # Go entry point
│   ├── main.go
│   └── webdist/          # Embedded frontend build (//go:embed)
├── internal/
│   ├── api/router.go     # HTTP routes + proxy handler
│   ├── db/schema.go      # SQLite schema + CRUD
│   ├── epg/xmltv.go      # XMLTV EPG parser
│   ├── hdhomerun/        # HDHomeRun tuner discovery
│   ├── iptv/m3u.go       # M3U playlist parser
│   └── stream/manager.go # FFmpeg HLS stream manager
└── web/                  # React + TypeScript + Tailwind v4
    └── src/
        ├── components/   # UI components
        ├── hooks/        # useApi hook
        └── lib/          # HLS.js context
```

## Key Patterns

- **API routes** use chi router in `router.go`
- **Multi-Source Architecture** uses `source_id` foreign keys for `channels` and `epg_entries`. The frontend organizes content by `activeSourceId` in horizontal tabs.
- **Settings Dashboard** supports full CRUD operations for multiple M3U, XMLTV, and HDHomeRun sources.
- **CORS** is handled per-route via `corsMiddleware`
- **HLS proxying** happens through `/api/proxy` endpoint (playlist-only proxy + segment proxying)
- **FFmpeg** is used for non-HLS streams via `/api/stream/start` (kept as fallback)
- **AES-128 keys** are proxied through `/api/proxy` with `Origin: http://pluto.tv`
- **M3U refresh** is lazy — re-fetches every 15 min on channel click
- **Variant cache** stores resolved variant URLs to skip master re-resolution
- **Auto-recovery** on hls.js fatal errors (3 attempts, 2s delay, live edge resume)
- **Player State** resets `isAtLiveEdge` and `isPlaying` correctly on channel switches.
- **EPG Grid Rendering** is heavily memoized (`useMemo`) to prevent thousands of DOM nodes from re-rendering on state changes (like opening modals). ALWAYS place hooks at the top level of `EpgGrid.tsx` to avoid "Rules of Hooks" violations.
- **EPG Infinite Scroll (Horizontal/Vertical)** dynamically appends 2-hour blocks to the grid width. It also uses a `visibleRows` state with `startTransition` to implement vertical lazy rendering, ensuring tuner switches are instantaneous.
- **HDHomeRun EPG Integration**: Uses SiliconDust's XMLTV API (`api.hdhomerun.com/api/xmltv`). Requires `User-Agent` and `Accept-Encoding: gzip` headers. Timestamps are parsed from local time and strictly converted to UTC (`.UTC().Format(time.RFC3339)`) before SQLite insertion to prevent timezone mismatch errors on the frontend.
- **EPG Category Mapping** normalizes messy M3U `group_title` values into 9 fixed buckets (Movies, News, Sports, etc.) on the frontend.
- **Hero Fallbacks**: The channel list Hero defaults to the first available channel in the current category. Posters fall back to the channel `logo_url` if the EPG program lacks an `<icon src>`.

## Known PlutoTV Constraints

- CDN returns `Access-Control-Allow-Origin: http://pluto.tv` → proxy must set `Origin: http://pluto.tv`
- AES-128 key files must be 16 bytes; proxy returns them as-is from CDN
- Session tokens rotate unpredictably (2-10 min); variant cache stall detection + lazy M3U refresh handle this
- `#EXT-X-DISCONTINUITY` triggers proxy to re-resolve from master
