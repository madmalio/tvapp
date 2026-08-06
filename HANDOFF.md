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
- Backend DB wipes are now disabled so all configured sources persist permanently across server restarts.

EPG (Live TV Guide) and Channel List improvements:
- XMLTV parsing maps to M3U PlutoTV channels.
- High-performance, heavily memoized React grid handles thousands of program nodes.
- Infinite horizontal scroll implemented via time-windowed SQL queries.
- Vertical infinite scroll implemented via `visibleRows` state, ensuring instantaneous tab switching.
- Raw M3U group titles are dynamically mapped into simplified categories (Movies, News, Kids, etc.).
- Channel Hero image caches are robust, falling back to channel logos when EPG posters are missing.

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

### Proactive Session Management

- **Variant cache** caches resolved variant URL per master URL
- **Media sequence tracking** — if sequence doesn't advance between fetches, detects stall and re-resolves from master (fresh tokens)
- **Discontinuity detection** — `#EXT-X-DISCONTINUITY` triggers re-resolution for ad transitions
- **Cache TTL** — 10 minutes; expired entries force master re-resolution
- **Lazy M3U refresh** — channel stream URLs refreshed from original M3U every 15 min on-demand

### Auto-Recovery (Frontend)

- On hls.js fatal error, destroys and re-creates hls instance
- 2-second delay, up to 3 attempts
- Resumes from live edge (no seek to stale position)
- Spinner overlay during recovery (no text blocking video)

## Key Files

| File | Purpose |
|------|---------|
| `internal/api/router.go` | All HTTP routes, proxy handler, variant cache, lazy refresh |
| `internal/iptv/m3u.go` | M3U playlist parser (UA/Referer/Origin headers) |
| `internal/stream/manager.go` | FFmpeg stream manager (fallback for non-HLS) |
| `internal/db/schema.go` | SQLite schema, CRUD, UpdateChannelURL |
| `web/src/components/VideoPlayer.tsx` | hls.js player with auto-recovery |
| `web/src/components/Settings.tsx` | M3U/EPG URL input, HDHomeRun scan |

## Configuration

- No `.env` needed. Port defaults to `8080` (override via `PORT` env var)
- FFmpeg must be in PATH (only used for non-HLS fallback)
- SQLite database `tvapp.db` created automatically

## Known Issues

### 1. Freeze after extended playback (2-15 min intervals)

**Symptoms**: Stream plays for 2-15 minutes then freezes. hls.js recovers (auto-reconnect kicks in), but the freeze may repeat.

**Root cause**: PlutoTV CDN rotates session tokens on an unpredictable schedule. The proxy detects stalls via media-sequence checks and re-resolves, but there's a brief interruption during the transition.

**Status**: Mitigated by proactive detection + auto-recovery. Not fully solved.

**Potential improvements**:
- Reduce the stall detection interval (currently only checks on manifest refresh, which is every ~5s)
- Add a background keepalive goroutine that proactively re-resolves cached variants every 60s
- Test with different hls.js buffer/retry settings

### 2. Some channels more prone to freezes than others

**Symptoms**: Certain PlutoTV channels (movie channels with AES-128 DRM) freeze more often than unencrypted channels.

**Root cause**: AES-128 key file requests add additional failure points. If a key file fetch fails, the segment can't be decrypted.

**Status**: Key files now return correct 16-byte keys with the `Origin: http://pluto.tv` fix.

**Potential improvements**: Monitor key file response sizes server-side and log failures.

### 3. FFmpeg path may be stale

The FFmpeg stream manager (`internal/stream/manager.go`) has resilience flags (`-fflags +genpts`, `-err_detect ignore_err`, etc.) added during development but is no longer the primary path for PlutoTV. It's kept as a fallback for non-HLS streams (e.g., raw MPEG-TS from HDHomeRun). May need testing if used.

### 4. EPG Architecture Notes

The EPG data flows from XMLTV parsing into SQLite. Due to the massive scale of EPG data (tens of thousands of nodes):
- The backend API (`/api/epg`) uses strict time-windowing bounds.
- The frontend grid (`EpgGrid.tsx`) uses `useMemo` hooks per-row to isolate render cycles.
- Horizontal scrolling dynamically bumps the `durationHours` state to fetch new blocks.

## Dependencies

- **Go 1.22+** — Chi v5, go-sqlite3
- **Node/TypeScript** — React 19, React Router, hls.js, Tailwind CSS v4
- **System** — FFmpeg (for non-HLS fallback only)

## Future Work

1. **Favorites** — The `favorites` table exists in the schema but no UI
2. **Channel search** — Text search for channels/programs
3. **DVR / Recording** — Hook up future program clicks in the modal to a scheduled recording service
4. **Stream analytics** — Track freeze frequency, recovery success rate, buffer health
5. **Native HLS on Safari** — Detect Safari and use `<video src>` directly (no proxy needed, bypasses CORS)
