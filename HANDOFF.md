# tvapp - Handoff Document

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
- EPG Mobile UI: The EPG grid automatically centers the red current-time playhead upon mounting, and programs feature mobile-only sticky titles.
- **Embedded EPG Parsing**: The `m3u.go` parser was updated to extract embedded `url-tvg` attributes in playlists, and `xmltv.go` safely decompresses `.gz` XMLTV files via magic byte inspection (`0x1f 0x8b`), bypassing missing `Content-Encoding: gzip` headers. 
- **Auto-Categorization**: Channels missing explicit EPG mapping utilize aggressive regex heuristics (`mapCategory`) in the frontend to reliably sort into standard buckets (Movies, Sports, News, etc.). Channels with absolutely no data generate 24-hour dummy blocks so they remain clickable in the UI.

Video Player UX Improvements:
- **Security Camera PiP Overlay**: Displays RTSP cameras as a floating overlay on top of broadcasts. Note: *This feature, along with its UI toggles in the VideoPlayer and Settings, is explicitly hidden on mobile devices* to preserve screen space.
- **Native OS PiP Adjustments**: Native PiP is enabled for desktop mode. A `leavepictureinpicture` handler was added to immediately issue a `play()` command within 10ms of closing the PiP window via the native "X" button to circumvent the browser's hardcoded auto-pause.
- **Streaming Quality Automations**: The frontend performs a speed test via `useSpeedTest.ts` to automatically select the best stream quality. Manual overrides by the user are now saved in `sessionStorage` rather than `localStorage`, ensuring the app naturally reassesses the connection quality on every fresh app load.
- **Mobile Menu Interactions**: Fixed iOS double-tap bugs where fixed absolute positioning elements (Quality toggle, Camera PiP toggle) failed to open.

**MediaMTX Live Streaming Architecture (HDHomeRun & Custom Streams)**:
- Migrated away from disk-based `.ts` chunk generation which caused severe disk I/O bottlenecks and stuttering.
- `ffmpeg` now pipes streams directly into MediaMTX memory via RTSP (`rtsp://localhost:8554/<id>`).
- Solved MediaMTX UDP remuxing stalls over Tailscale by forcing `-pkt_size 1200` in the `ffmpeg` pipeline.
- `tvapp` backend reverse-proxies MediaMTX's Low-Latency HLS (`http://127.0.0.1:8888/<id>/index.m3u8`), strictly forwarding query parameters (`?session=...`) to ensure MediaMTX validates segment requests.

## Architecture

### Streaming Pipeline (PlutoTV / HLS streams)

```
User clicks channel
    GET /api/channels/{id}  (lazy M3U refresh if >15 min old)
    hls.js loads /api/proxy?url=<channel_stream_url>
      Proxy fetches master playlist from PlutoTV CDN
      Resolves best variant (highest bandwidth)
      Caches variant URL with media-sequence tracking
      Rewrites playlist URLs through /api/proxy
      Returns rewritten playlist to browser
    Browser fetches segments and key files through proxy
      Proxy adds Origin: http://pluto.tv, Referer: http://pluto.tv/
      Shared cookie jar preserves CDN cookies across requests
    hls.js decrypts AES-128 segments and plays
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
| `web/src/components/EpgGrid.tsx` | EPG Timeline Guide (Desktop/Mobile view with sticky titles) |
| `web/src/components/VideoPlayer.tsx` | hls.js player with Native PiP overrides |

## Known Constraints & Dead Ends

- **Do Not Replace MediaMTX with go2rtc**: MediaMTX is our unified streaming server (handling RTSP ingestion from FFmpeg, WebRTC on `:8889`, and LL-HLS on `:8888`). A previous attempt to introduce `go2rtc` added unnecessary complexity and caused stream instability. WebRTC via MediaMTX is working well with FFmpeg audio transcoding (`pcm_mulaw`).
- **Native OS PiP Auto-Pause**: The browser inherently fires a `pause` command when exiting PiP via the 'X' button. We successfully circumvent this using a 10ms `setTimeout()` inside `leavepictureinpicture`, but there is still a fractional visual pause as the browser halts and we immediately force it back into a playing state.
- **Accidental Category Resets**: Mobile users frequently tap the active Tuner Pill which, without a strict check (`activeSourceId !== src.id`), resets their category filtering to "All". This was patched today but must be kept in mind for new UI elements.

## Future Work

1. **Mobile Sticky Titles Issue**: The user previously noted that "there is an issue with the sticky titles but i we will pick back up tomorrow." In `EpgGrid.tsx`, `max-md:sticky max-md:left-0` was implemented to keep program titles visible on mobile during horizontal scrolling.
2. **Favorites** - The `favorites` table exists in the schema but no UI
3. **Channel search** - Text search for channels/programs
4. **DVR / Recording** - Hook up future program clicks in the modal to a scheduled recording service
5. **Native HLS on Safari** - Detect Safari and use `<video src>` directly (no proxy needed, bypasses CORS)
