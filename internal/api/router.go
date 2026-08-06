package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"net/http/cookiejar"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"tvapp/internal/db"
	"tvapp/internal/epg"
	"tvapp/internal/hdhomerun"
	"tvapp/internal/iptv"
	"tvapp/internal/stream"
)

func NewRouter(distFS fs.FS) *chi.Mux {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	r.Get("/health", healthHandler)
	r.Get("/api/devices", listDevicesHandler)
	r.Get("/api/channels", listChannelsHandler)
	r.Get("/api/channels/{id}", getChannelHandler)
	r.Get("/api/proxy", proxyStreamHandler)
	r.Post("/api/playlists/parse", parsePlaylistHandler)
	r.Post("/api/epg/parse", parseEpgHandler)
	r.Get("/api/epg", getEpgHandler)
	r.Post("/api/stream/start", startStreamHandler)
	r.Delete("/api/stream/stop/{id}", stopStreamHandler)
	r.Get("/api/stream/hls/*", serveHLSHandler)

	fileServer := http.FileServer(http.FS(distFS))
	r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
		path := strings.TrimPrefix(req.URL.Path, "/")
		if path != "" {
			if _, err := fs.Stat(distFS, path); err == nil {
				fileServer.ServeHTTP(w, req)
				return
			}
		}
		
		content, err := fs.ReadFile(distFS, "index.html")
		if err != nil {
			http.NotFound(w, req)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(content)
	})

	return r
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func listDevicesHandler(w http.ResponseWriter, r *http.Request) {
	devices, err := hdhomerun.Discover(r.Context())
	if err != nil {
		log.Printf("discover error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(devices)
}

func listChannelsHandler(w http.ResponseWriter, r *http.Request) {
	channels, err := db.GetChannels()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if channels == nil {
		channels = []db.ChannelRow{}
	}
	json.NewEncoder(w).Encode(channels)
}

func getChannelHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	force := r.URL.Query().Get("force") == "true"
	ch, err := refreshChannelIfStale(id, force)
	if err != nil {
		http.Error(w, "channel not found", http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(ch)
}

func refreshChannelIfStale(id int, force bool) (*db.ChannelRow, error) {
	lastM3UMu.Lock()
	needsRefresh := force || (time.Since(lastM3URefresh) > 15*time.Minute && lastM3UURL != "")
	lastM3UMu.Unlock()

	if !needsRefresh {
		return db.GetChannel(id)
	}

	channels, err := iptv.ParseM3U(lastM3UURL)
	if err != nil {
		log.Printf("[m3u] refresh failed: %v, using stored data", err)
		lastM3UMu.Lock()
		lastM3URefresh = time.Now()
		lastM3UMu.Unlock()
		return db.GetChannel(id)
	}

	current, err := db.GetChannel(id)
	if err != nil {
		return nil, err
	}

	for _, ch := range channels {
		if ch.Name == current.Name {
			if ch.StreamURL != current.StreamURL {
				log.Printf("[m3u] refreshed URL for channel %d (%s)", id, current.Name)
				db.UpdateChannelURL(id, ch.StreamURL)
				current.StreamURL = ch.StreamURL
			}
			break
		}
	}

	lastM3UMu.Lock()
	lastM3URefresh = time.Now()
	lastM3UMu.Unlock()
	return current, nil
}

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

var (
	sharedCookieJar http.CookieJar
	lastM3UURL      string
	lastM3URefresh  time.Time
	lastM3UMu       sync.Mutex
)

type variantCacheEntry struct {
	variantURL    string
	createdAt     time.Time
	mediaSequence int
	lastAccessed  time.Time
}

var variantCache sync.Map

func init() {
	sharedCookieJar, _ = cookiejar.New(nil)
	go startVariantKeepalive()
}

func startVariantKeepalive() {
	ticker := time.NewTicker(60 * time.Second)
	for range ticker.C {
		variantCache.Range(func(key, value any) bool {
			target := key.(string)
			entry := value.(*variantCacheEntry)

			if time.Since(entry.lastAccessed) > 15*time.Minute {
				log.Printf("[keepalive] removing stale variant cache for %s", target)
				variantCache.Delete(key)
				return true
			}

			req, err := http.NewRequest("GET", target, nil)
			if err != nil {
				return true
			}
			req.Header.Set("User-Agent", userAgent)
			req.Header.Set("Referer", "http://pluto.tv/")
			req.Header.Set("Origin", "http://pluto.tv")

			client := &http.Client{Jar: sharedCookieJar}
			resp, err := client.Do(req)
			if err != nil {
				return true
			}
			defer resp.Body.Close()

			body, _ := io.ReadAll(resp.Body)
			if bytes.Contains(body, []byte("#EXT-X-STREAM-INF:")) {
				if variant, vURL := hlsResolveBestVariant(body, resp.Request.URL); variant != nil {
					log.Printf("[keepalive] refreshed variant URL for %s", target)
					entry.variantURL = vURL.String()
					entry.createdAt = time.Now()
				}
			}

			return true
		})
	}
}

func proxyStreamHandler(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	if target == "" {
		http.Error(w, "url required", http.StatusBadRequest)
		return
	}

	proxyReq, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	forwardedHeaders := []string{
		"Range", "If-Modified-Since", "If-None-Match",
		"User-Agent", "Accept", "Accept-Language",
		"Referer", "Origin",
	}
	for _, h := range forwardedHeaders {
		if v := r.Header.Get(h); v != "" {
			proxyReq.Header.Set(h, v)
		}
	}
	if proxyReq.Header.Get("User-Agent") == "" {
		proxyReq.Header.Set("User-Agent", userAgent)
	}
	proxyReq.Header.Set("Referer", "http://pluto.tv/")
	proxyReq.Header.Set("Origin", "http://pluto.tv")

	client := &http.Client{
		Jar: sharedCookieJar,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			for _, h := range forwardedHeaders {
				if v := proxyReq.Header.Get(h); v != "" {
					req.Header.Set(h, v)
				}
			}
			return nil
		},
	}
	resp, err := client.Do(proxyReq)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	ct := resp.Header.Get("Content-Type")
	isHLS := strings.Contains(ct, "mpegurl") || strings.Contains(ct, "apple") || bytes.HasPrefix(body, []byte("#EXTM3U"))

	if !isHLS {
		for _, h := range []string{"Content-Type", "Content-Length", "Accept-Ranges", "Cache-Control", "Last-Modified", "ETag", "Set-Cookie"} {
			if v := resp.Header.Get(h); v != "" {
				w.Header().Set(h, v)
			}
		}
		w.WriteHeader(resp.StatusCode)
		w.Write(body)
		return
	}

	w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Del("Content-Length")

	// Forward Set-Cookie to browser so it matches the original domain domain
	for _, c := range resp.Header.Values("Set-Cookie") {
		w.Header().Add("Set-Cookie", c)
	}

	w.WriteHeader(http.StatusOK)

	// Variant cache: skip master resolution on subsequent requests
	var variantURL *url.URL
	var fromCache bool
	if cached, ok := variantCache.Load(target); ok {
		entry := cached.(*variantCacheEntry)
		entry.lastAccessed = time.Now()
		if time.Since(entry.createdAt) < 10*time.Minute {
			log.Printf("[proxy] fetching cached variant: %s", entry.variantURL)
			req, _ := http.NewRequest("GET", entry.variantURL, nil)
			req.Header.Set("User-Agent", userAgent)
			if u, err := url.Parse(entry.variantURL); err == nil {
				req.Header.Set("Referer", u.Scheme+"://"+u.Host+"/")
			}
			vc := &http.Client{Jar: sharedCookieJar}
			if vResp, vErr := vc.Do(req); vErr == nil {
				vBody, _ := io.ReadAll(vResp.Body)
				vResp.Body.Close()
				if bytes.HasPrefix(vBody, []byte("#EXTM3U")) {
					bodyStr := string(vBody)
					newSeq := parseMediaSequence(bodyStr)
					stalled := entry.mediaSequence >= 0 && newSeq >= 0 && newSeq <= entry.mediaSequence
					if stalled {
						log.Printf("[proxy] variant stalled (seq %d->%d), re-resolving", entry.mediaSequence, newSeq)
						variantCache.Delete(target)
					} else {
						log.Printf("[proxy] cached variant fetched: %d bytes (seq=%d)", len(vBody), newSeq)
						body = vBody
						variantURL = vResp.Request.URL
						fromCache = true
						entry.mediaSequence = newSeq
						entry.createdAt = time.Now()
						variantCache.Store(target, entry)
					}
				}
			}
			if !fromCache {
				log.Printf("[proxy] cached variant failed, re-resolving from master")
				variantCache.Delete(target)
			}
		} else {
			variantCache.Delete(target)
		}
	}

	if !fromCache && bytes.Contains(body, []byte("#EXT-X-STREAM-INF:")) {
		log.Printf("[proxy] master playlist detected, resolving best variant...")
		if variant, vURL := hlsResolveBestVariant(body, resp.Request.URL); variant != nil {
			log.Printf("[proxy] variant resolved: %d bytes", len(variant))
			body = variant
			variantURL = vURL
			variantCache.Store(target, &variantCacheEntry{variantURL: vURL.String(), createdAt: time.Now(), lastAccessed: time.Now()})
		} else {
			log.Printf("[proxy] variant resolution failed, returning master as-is")
		}
	}

	finalURL := resp.Request.URL
	if variantURL != nil {
		finalURL = variantURL
	}
	base := &url.URL{Scheme: finalURL.Scheme, Host: finalURL.Host}
	basePath := finalURL.Path
	if idx := strings.LastIndex(basePath, "/"); idx >= 0 {
		basePath = basePath[:idx+1]
	}
	queryParams := finalURL.RawQuery

	body = hlsCleanPlaylist(body, base, basePath, queryParams)
	w.Write(body)
}

func hlsResolveBestVariant(master []byte, masterURL *url.URL) ([]byte, *url.URL) {
	lines := strings.Split(string(master), "\n")
	var bestURL string
	var maxBW int
	var variantsFound int

	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if !strings.HasPrefix(line, "#EXT-X-STREAM-INF:") {
			continue
		}
		bw := parseHLSBandwidth(line)
		if i+1 < len(lines) {
			next := strings.TrimSpace(lines[i+1])
			if next != "" && !strings.HasPrefix(next, "#") {
				variantsFound++
				resolved := resolveHLSURL(masterURL, next)
				if bw >= maxBW {
					maxBW = bw
					bestURL = resolved
				}
			}
		}
	}

	log.Printf("[proxy] variants found: %d, best bandwidth: %d", variantsFound, maxBW)

	if bestURL == "" {
		log.Printf("[proxy] no variant URL found")
		return nil, nil
	}

	log.Printf("[proxy] fetching best variant: %s", bestURL)

	req, err := http.NewRequest("GET", bestURL, nil)
	if err != nil {
		log.Printf("[proxy] create variant request error: %v", err)
		return nil, nil
	}
	req.Header.Set("User-Agent", userAgent)
	if slash := strings.Index(bestURL[8:], "/"); slash >= 0 {
		req.Header.Set("Referer", bestURL[:slash+8+1])
	}

	vc := &http.Client{Jar: sharedCookieJar}
	resp, err := vc.Do(req)
	if err != nil {
		log.Printf("[proxy] variant fetch error: %v", err)
		return nil, nil
	}
	defer resp.Body.Close()

	log.Printf("[proxy] variant response status: %d", resp.StatusCode)

	variant, _ := io.ReadAll(resp.Body)
	log.Printf("[proxy] variant body length: %d", len(variant))
	if len(variant) == 0 || resp.StatusCode != 200 {
		log.Printf("[proxy] variant fetch failed (status=%d, len=%d)", resp.StatusCode, len(variant))
		return nil, nil
	}
	if !bytes.HasPrefix(variant, []byte("#EXTM3U")) {
		log.Printf("[proxy] variant not HLS (%dB, starts with %q), returning nil", len(variant), string(variant[:min(len(variant), 60)]))
		return nil, nil
	}

	variantBase, _ := url.Parse(bestURL)
	return variant, variantBase
}

func parseHLSBandwidth(line string) int {
	idx := strings.Index(line, "BANDWIDTH=")
	if idx < 0 {
		return 0
	}
	rest := line[idx+10:]
	if comma := strings.IndexByte(rest, ','); comma >= 0 {
		rest = rest[:comma]
	}
	bw, _ := strconv.Atoi(rest)
	return bw
}

func resolveHLSURL(base *url.URL, raw string) string {
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		return raw
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	return base.ResolveReference(parsed).String()
}

func hlsCleanPlaylist(body []byte, base *url.URL, basePath string, queryParams string) []byte {
	lines := strings.Split(string(body), "\n")
	var out []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "#EXT-X-MEDIA:TYPE=SUBTITLES") {
			continue
		}
		if strings.HasPrefix(trimmed, "#EXT-X-STREAM-INF:") {
			parts := strings.Split(line, ",")
			var cleaned []string
			for _, p := range parts {
				if !strings.HasPrefix(strings.TrimSpace(p), "SUBTITLES=") {
					cleaned = append(cleaned, p)
				}
			}
			line = strings.Join(cleaned, ",")
		}
		line = rewriteAllURIs(line, base, basePath, queryParams)
		if !strings.HasPrefix(trimmed, "#") {
			line = resolveURL(line, base, basePath, queryParams)
		}
		out = append(out, line)
	}
	return []byte(strings.Join(out, "\n"))
}

func rewriteAllURIs(line string, base *url.URL, basePath string, queryParams string) string {
	var result strings.Builder
	result.Grow(len(line) + 128)
	remaining := line
	for {
		idx := strings.Index(remaining, "URI=\"")
		if idx < 0 {
			result.WriteString(remaining)
			break
		}
		result.WriteString(remaining[:idx+5])
		remaining = remaining[idx+5:]
		end := strings.IndexByte(remaining, '"')
		if end < 0 {
			result.WriteString(remaining)
			break
		}
		orig := remaining[:end]
		result.WriteString(resolveURL(orig, base, basePath, queryParams))
		remaining = remaining[end:]
	}
	return result.String()
}

func resolveURL(raw string, base *url.URL, basePath string, queryParams string) string {
	switch {
	case strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://"):
		return "/api/proxy?url=" + url.QueryEscape(raw)
	case strings.HasPrefix(raw, "//"):
		raw = base.Scheme + ":" + raw
		return "/api/proxy?url=" + url.QueryEscape(raw)
	case strings.HasPrefix(raw, "/"):
		raw = base.Scheme + "://" + base.Host + raw
		return "/api/proxy?url=" + url.QueryEscape(raw)
	default:
		raw = base.Scheme + "://" + base.Host + basePath + raw
		raw = appendQuery(raw, queryParams)
		return "/api/proxy?url=" + url.QueryEscape(raw)
	}
}

func parseMediaSequence(body string) int {
	idx := strings.Index(body, "#EXT-X-MEDIA-SEQUENCE:")
	if idx < 0 {
		return -1
	}
	rest := body[idx+len("#EXT-X-MEDIA-SEQUENCE:"):]
	rest = strings.TrimSpace(rest)
	end := strings.IndexByte(rest, '\n')
	if end < 0 {
		n, _ := strconv.Atoi(rest)
		return n
	}
	n, _ := strconv.Atoi(rest[:end])
	return n
}

func appendQuery(raw string, qs string) string {
	if qs == "" {
		return raw
	}
	if strings.Contains(raw, "?") {
		return raw + "&" + qs
	}
	return raw + "?" + qs
}

func parsePlaylistHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.URL == "" {
		http.Error(w, "url required", http.StatusBadRequest)
		return
	}

	iptvChannels, err := iptv.ParseM3U(req.URL)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	lastM3UMu.Lock()
	lastM3UURL = req.URL
	lastM3URefresh = time.Now()
	lastM3UMu.Unlock()
	log.Printf("[m3u] loaded %d channels from %s", len(iptvChannels), req.URL)

	rows := make([]db.ChannelRow, len(iptvChannels))
	for i, ch := range iptvChannels {
		rows[i] = db.ChannelRow{
			Name:       ch.Name,
			StreamURL:  ch.StreamURL,
			LogoURL:    ch.LogoURL,
			GroupTitle: ch.GroupTitle,
			TunerType:  "iptv",
			TvgID:      ch.TvgID,
		}
	}

	if err := db.ClearChannels(); err != nil {
		log.Printf("clear channels: %v", err)
	}
	if err := db.SaveChannels(rows); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	saved, _ := db.GetChannels()
	json.NewEncoder(w).Encode(saved)
}

func parseEpgHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.URL == "" {
		http.Error(w, "url required", http.StatusBadRequest)
		return
	}

	entries, err := epg.ParseXMLTV(req.URL)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	channels, err := db.GetChannels()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	channelMap := make(map[string]int)
	for _, ch := range channels {
		if ch.TvgID != "" {
			channelMap[ch.TvgID] = ch.ID
		}
	}

	rows := []db.EPGEntryRow{}
	for _, e := range entries {
		if dbID, ok := channelMap[e.ChannelID]; ok {
			rows = append(rows, db.EPGEntryRow{
				ChannelID:   dbID,
				Title:       e.Title,
				Description: e.Description,
				PosterURL:   e.PosterURL,
				StartTime:   e.StartTime.Format(time.RFC3339),
				EndTime:     e.EndTime.Format(time.RFC3339),
			})
		}
	}

	if err := db.ClearEPGEntries(); err != nil {
		log.Printf("clear epg entries: %v", err)
	}
	if err := db.SaveEPGEntries(rows); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[epg] loaded %d entries from %s", len(rows), req.URL)
	json.NewEncoder(w).Encode(rows)
}

func getEpgHandler(w http.ResponseWriter, r *http.Request) {
	start := r.URL.Query().Get("start")
	end := r.URL.Query().Get("end")

	var entries []db.EPGEntryRow
	var err error

	if start != "" && end != "" {
		entries, err = db.GetEPGEntriesByTime(start, end)
	} else {
		entries, err = db.GetAllEPGEntries()
	}

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if entries == nil {
		entries = []db.EPGEntryRow{}
	}
	json.NewEncoder(w).Encode(entries)
}

func startStreamHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.URL == "" {
		http.Error(w, "url required", http.StatusBadRequest)
		return
	}

	sess, err := stream.Start(req.URL)
	if err != nil {
		log.Printf("[stream] start error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"id":           sess.ID,
		"manifest_url": fmt.Sprintf("/api/stream/hls/%s/stream.m3u8", sess.ID),
	})
}

func stopStreamHandler(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		http.Error(w, "id required", http.StatusBadRequest)
		return
	}
	stream.Stop(id)
	w.WriteHeader(http.StatusNoContent)
}

func serveHLSHandler(w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(r.URL.Path, "/api/stream/hls/")
	if rel == "" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	parts := strings.SplitN(rel, "/", 2)
	if len(parts) < 2 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	id := parts[0]
	filename := parts[1]

	sess := stream.GetSession(id)
	if sess == nil {
		http.Error(w, "stream not found", http.StatusNotFound)
		return
	}

	// For manifest requests, wait up to 30s for FFmpeg to produce it
	if filename == "stream.m3u8" {
		if !sess.WaitReady(30 * time.Second) {
			http.Error(w, "stream timeout", http.StatusGatewayTimeout)
			return
		}
	}

	filePath := filepath.Join(sess.Dir, filename)
	if _, err := os.Stat(filePath); err != nil {
		w.Header().Set("Retry-After", "2")
		http.Error(w, "segment not ready", http.StatusServiceUnavailable)
		return
	}
	switch {
	case strings.HasSuffix(filename, ".m3u8"):
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	case strings.HasSuffix(filename, ".ts"):
		w.Header().Set("Content-Type", "video/mp2t")
	case strings.HasSuffix(filename, ".m4s"):
		w.Header().Set("Content-Type", "video/iso.segment")
	case strings.HasSuffix(filename, ".mp4"):
		w.Header().Set("Content-Type", "video/mp4")
	}
	http.ServeFile(w, r, filePath)
}
