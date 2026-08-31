# tvapp - Agent Instructions

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

# Dev (no embedded frontend - uses Vite dev server on :5173 proxied to :8080)
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
- **RTSP Cameras Dashboard**: RTSP cameras are managed as `sources` with `type="rtsp"`, but they are designed to be explicitly excluded from the `channels` table and TV guide. They have their own dedicated dashboard (`/cameras`).
- **MediaMTX WebRTC & HLS Streaming**: RTSP cameras support both WebRTC (low latency) and HLS streaming directly through MediaMTX (WebRTC on `:8889`, HLS on `:8888`). Audio is transcoded via FFmpeg (`pcm_mulaw`) so browser WebRTC playback works smoothly without codec errors. Note: Do not attempt to replace MediaMTX with `go2rtc`.
- **Settings Dashboard** supports full CRUD operations for multiple M3U, XMLTV, HDHomeRun, and RTSP sources.
- **CORS** is handled per-route via `corsMiddleware`
- **HLS proxying** happens through `/api/proxy` endpoint (playlist-only proxy + segment proxying)
- **FFmpeg** is used for non-HLS streams via `/api/stream/start` (kept as fallback)
- **AES-128 keys** are proxied through `/api/proxy` with `Origin: http://pluto.tv`
- **M3U refresh** is lazy - re-fetches every 15 min on channel click
- **Variant cache** stores resolved variant URLs to skip master re-resolution
- **Auto-recovery** on hls.js fatal errors (3 attempts, 2s delay, live edge resume)
- **Player State** resets `isAtLiveEdge` and `isPlaying` correctly on channel switches.
- **EPG Grid Rendering** is heavily memoized (`useMemo`) to prevent thousands of DOM nodes from re-rendering on state changes (like opening modals). ALWAYS place hooks at the top level of `EpgGrid.tsx` to avoid "Rules of Hooks" violations.
- **EPG Infinite Scroll (Horizontal/Vertical)** dynamically appends 2-hour blocks to the grid width. It also uses a `visibleRows` state with `startTransition` to implement vertical lazy rendering, ensuring tuner switches are instantaneous.
- **EPG Mobile Layout**: The Guide has mobile-specific sticky program titles (using Tailwind `max-md:sticky max-md:left-0`). The grid also automatically calculates the offset and centers the current time (red playhead) on component mount using `scrollContainerRef`.
- **Native OS Picture-in-Picture**: Browsers natively force a `pause()` command when closing a PiP window via the 'X' button. To counteract this, `VideoPlayer.tsx` listens to the `leavepictureinpicture` event and immediately issues a `play()` command (and restores `isAtLiveEdge` if applicable) via a tiny 10ms timeout to ensure seamless continuation.
- **HDHomeRun EPG Integration**: Uses SiliconDust's XMLTV API (`api.hdhomerun.com/api/xmltv`). Requires `User-Agent` and `Accept-Encoding: gzip` headers. Timestamps are parsed from local time and strictly converted to UTC (`.UTC().Format(time.RFC3339)`) before SQLite insertion to prevent timezone mismatch errors on the frontend.
- **EPG Category Mapping** normalizes messy M3U `group_title` values into 9 fixed buckets (Movies, News, Sports, etc.) on the frontend.
- **Hero Fallbacks**: The channel list Hero defaults to the first available channel in the current category. Posters fall back to the channel `logo_url` if the EPG program lacks an `<icon src>`.
- **GZIP Payloads**: EPG data from URLs is decompressed using magic byte inspection (`0x1f 0x8b`), avoiding issues with missing `Content-Encoding: gzip` headers.
- **M3U Parsing**: Extracts both `x-tvg-url` and `url-tvg` via regex from `#EXTM3U`. EPG linking falls back to case-insensitive name matching if `tvg-id` is absent.
- **Mobile Adjustments**: PiP functionality and related settings are explicitly hidden on mobile layouts via Tailwind (`hidden sm:block`) to save space. Navigation avoids accidentally resetting states (like category going back to "All") by utilizing strict change-checks on tuner pills (`activeSourceId !== src.id`).
- **Streaming Quality Override**: Manual quality overrides are saved in `sessionStorage` rather than `localStorage`, meaning the automatic speed test will appropriately re-assess the default quality on every new session/app load.
- **DVR Architecture**: Scheduled and manual recordings use `internal/stream/recorder.go` to save streams directly to disk. HDHomeRun recordings are transcoded on-the-fly to H.264 so they play natively in web browsers. Finished recordings are automatically remuxed into a single `.mp4` file via `-movflags +faststart` to enable instant scrubbing. Live recordings sync with EPG end times and enforce a strict shutdown via `context.WithTimeout` to prevent run-on. Active recordings can be gracefully stopped manually from the DVR UI or by toggling the record button in the player.

## Known PlutoTV Constraints

- CDN returns `Access-Control-Allow-Origin: http://pluto.tv` -> proxy must set `Origin: http://pluto.tv`
- AES-128 key files must be 16 bytes; proxy returns them as-is from CDN
- Session tokens rotate unpredictably (2-10 min); variant cache stall detection + lazy M3U refresh handle this
- `#EXT-X-DISCONTINUITY` triggers proxy to re-resolve from master
