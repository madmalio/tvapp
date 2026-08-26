# tvapp — Handoff Document

## Project Overview

A lightweight live TV media server and player built with Go (Chi router + SQLite) and React (TypeScript + Tailwind CSS v4 + hls.js). Supports IPTV (M3U playlists), HDHomeRun tuners, and EPG/XMLTV guide data.

## Current State

Core PlutoTV M3U playback is functional. Key challenges resolved:
- CORS (CDN requires `Origin: http://pluto.tv`)
- AES-128 key file retrieval (16-byte keys now fetch correctly)
- Manifest refresh and session expiry (proactive detection + auto-recovery)

Multi-Source Architecture is fully integrated:
- Supports unlimited M3U playlists and HDHomeRun tuners side-by-side.
- Database utilizes `source_id` foreign keys to track channels and EPG entries by source.
- UI implements horizontal Source Tabs allowing users to instantly switch between active tuners.
- Backend DB wipes are disabled so all configured sources persist permanently across server restarts.

EPG (Live TV Guide) and Channel List improvements:
- XMLTV parsing maps to M3U PlutoTV channels, and natively supports HDHomeRun XMLTV (extracting `display-name` and `icon src` to map channels correctly).
- **HDHomeRun Affiliate Extraction**: Dynamically scans HDHomeRun XMLTV arrays for affiliate network names (NBC, ABC, FOX, CBS, CW, PBS, ION), assigns the `GroupTitle` to "Local", and appends the network to the channel name for the UI.
- High-performance React grid (`ChannelList.tsx`) handles thousands of channels smoothly:
  - Memoized `ChannelCarousel` to prevent cascading redraws on hover.
  - EPG JSON is fetched *once* on load and cached in a state array, preventing network waterfall stalls during rapid hovering.
- Channel Hero image caches are robust, falling back to channel logos when EPG posters are missing.

**MediaMTX Live Streaming Architecture (HDHomeRun & Custom Streams)**:
- Migrated away from disk-based `.ts` chunk generation which caused severe disk I/O bottlenecks and stuttering.
- `ffmpeg` now pipes streams directly into MediaMTX memory via RTSP (`rtsp://localhost:8554/<id>`).
- Solved MediaMTX UDP remuxing stalls over Tailscale by forcing `-pkt_size 1200` in the `ffmpeg` pipeline.
- `tvapp` backend reverse-proxies MediaMTX's Low-Latency HLS (`http://127.0.0.1:8888/<id>/index.m3u8`), strictly forwarding query parameters (`?session=...`) to ensure MediaMTX validates segment requests.

## Architecture

### Streaming Pipeline (PlutoTV / HLS streams)

```
User clicks channel
  → GET /api/channels/{id}  (lazy M3U refresh if >15 min old)
  → hls.js loads /api/proxy?url=<channel_stream_url>
    → Proxy fetches master playlist from PlutoTV CDN
    → Resolves best variant (highest bandwidth)
    → Caches variant URL with media-sequence tracking
    → Rewrites playlist URLs through /api/proxy
    → Returns rewritten playlist to browser
  → Browser fetches segments and key files through proxy
    → Proxy adds Origin: http://pluto.tv, Referer: http://pluto.tv/
    → Shared cookie jar preserves CDN cookies across requests
  → hls.js decrypts AES-128 segments and plays
```

### Server Deployment

The user deploys this application to a Linux server on their network (`192.168.4.143`) which is also running MediaMTX locally. To deploy a new version:

```powershell
# 1. Build the Linux binary (make sure Vite frontend is built and copied into webdist first)
$env:GOOS="linux"; $env:GOARCH="amd64"; go build -o bin\tvapp-linux .\cmd\server\

# 2. Upload to server
scp .\bin\tvapp-linux mark@192.168.4.143:~/tvapp/tvapp

# 3. Wait for user to manually restart the process on the server
```

> **Note on Containerization**: `tvapp` currently spawns MediaMTX automatically as a child process. When writing the docker-compose stack in the future, this behavior in `cmd/server/main.go` MUST be reverted so they run as separate isolated containers.

## Key Files

| File | Purpose |
|------|---------|
| `internal/api/router.go` | HTTP routes, MediaMTX HLS proxy (`index.m3u8`), PlutoTV proxy |
| `internal/api/sources.go` | EPG and XMLTV import logic, HDHomeRun affiliate extraction |
| `internal/stream/manager.go` | FFmpeg manager (Pipes to MediaMTX via RTSP, `-pkt_size 1200`) |
| `web/src/components/ChannelList.tsx` | UI Guide, Hero Poster, Cached EPG, Memoized Carousel |
| `web/src/components/VideoPlayer.tsx` | hls.js player with auto-recovery |

## Known Constraints & Dead Ends

- **Do Not Replace MediaMTX with go2rtc**: MediaMTX is our unified streaming server (handling RTSP ingestion from FFmpeg, WebRTC on `:8889`, and LL-HLS on `:8888`). A previous attempt to introduce `go2rtc` added unnecessary complexity and caused stream instability. WebRTC via MediaMTX is working well with FFmpeg audio transcoding (`pcm_mulaw`).

## Outstanding Tasks

1. **RTSP Camera Bugs (HIGH PRIORITY)**: 
   - A new dedicated `Cameras.tsx` dashboard was built to display RTSP security cameras via MediaMTX, decoupling them from the main TV channels. However, there are two major issues the next agent MUST fix:
     - The RTSP streams are still failing to play in the `Cameras.tsx` grid. The frontend attempts to load them via `/api/proxy?url=http://127.0.0.1:8888/{cam_id}/index.m3u8` to bypass firewall ports, but MediaMTX or the `proxyStreamHandler` is failing to serve the stream correctly.
     - The ghost RTSP cameras are STILL showing up in the `ChannelList.tsx` and `EpgGrid.tsx` pages. The backend has an aggressive SQLite cleanup script in `schema.go` `Init()`, but it doesn't seem to be working, or the frontend/backend is still incorrectly mapping the sources.
2. **Distracting "Red Pill" UI**: When switching channels, a red "Starting stream..." pill flashes on the screen which the user finds distracting. Needs to be removed or smoothed out.
3. **Quality Selector Settings**: Ensure the UI quality selector correctly reflects and respects the bitrate/quality set by the automated speedtest.

## Future Work

1. **Favorites** — The `favorites` table exists in the schema but no UI
2. **Channel search** — Text search for channels/programs
3. **DVR / Recording** — Hook up future program clicks in the modal to a scheduled recording service
4. **Native HLS on Safari** — Detect Safari and use `<video src>` directly (no proxy needed, bypasses CORS)
