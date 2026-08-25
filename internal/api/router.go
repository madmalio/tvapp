package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/http/cookiejar"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"tvapp/internal/db"
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
	r.Get("/api/sources", getSourcesHandler)
	r.Post("/api/sources", addSourceHandler)
	r.Put("/api/sources/order", updateSourceOrderHandler)
	r.Put("/api/sources/{id}", updateSourceHandler)
	r.Delete("/api/sources/{id}", deleteSourceHandler)
	r.Get("/api/epg", getEpgHandler)
	r.Get("/api/speedtest", speedtestHandler)
	r.Get("/api/settings", getSettingsHandler)
	r.Put("/api/settings", updateSettingsHandler)
	r.Post("/api/stream/start", startStreamHandler)
	r.Delete("/api/stream/stop/{id}", stopStreamHandler)
	r.Get("/api/stream/heartbeat/{id}", heartbeatStreamHandler)
	r.Get("/api/stream/hls/*", serveHLSHandler)

	go2rtcProxy := httputil.NewSingleHostReverseProxy(&url.URL{Scheme: "http", Host: "127.0.0.1:1984"})
	r.Mount("/api/go2rtc", http.StripPrefix("/api/go2rtc", go2rtcProxy))

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
	current, err := db.GetChannel(id)
	if err != nil {
		return nil, err
	}

	// We no longer have a global lastM3URefresh because each source is parsed independently.
	// We'll rely on the client specifying `force=true` (like when switching channels) 
	// or we can track refresh times per source in the future.
	// For now, if force is requested and it's an IPTV channel, we re-parse its source.
	if !force || current.TunerType != "iptv" {
		return current, nil
	}

	source, err := db.GetSource(current.SourceID)
	if err != nil {
		return current, nil
	}

	channels, err := iptv.ParseM3U(source.URL)
	if err != nil {
		log.Printf("[m3u] refresh failed for source %d: %v, using stored data", source.ID, err)
		return current, nil
	}

	current, err = db.GetChannel(id)
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

	return current, nil
}

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

var (
	sharedCookieJar http.CookieJar
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

			if time.Since(entry.lastAccessed) > 2*time.Minute {
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

	// Only proxy known domains that require it (like PlutoTV) to bypass CORS and rewrite segment keys.
	// For other domains (like Tubi), we redirect to let the browser play the stream directly,
	// which offloads the backend and prevents stream freezing.
	lowerTarget := strings.ToLower(target)
	isMediaMTX := strings.Contains(lowerTarget, "127.0.0.1:8888") || strings.Contains(lowerTarget, "localhost:8888")
	if !strings.Contains(lowerTarget, "pluto") && !strings.Contains(lowerTarget, "jmp2.uk") && !isMediaMTX {
		http.Redirect(w, r, target, http.StatusFound)
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

	ct := strings.ToLower(resp.Header.Get("Content-Type"))
	isHLS := strings.Contains(ct, "mpegurl") || strings.Contains(ct, "apple")

	var body []byte
	if !isHLS {
		buf := make([]byte, 7)
		n, _ := io.ReadFull(resp.Body, buf)
		if string(buf[:n]) == "#EXTM3U" {
			isHLS = true
			rest, _ := io.ReadAll(resp.Body)
			body = append(buf[:n], rest...)
		} else {
			for _, h := range []string{"Content-Type", "Accept-Ranges", "Cache-Control", "Last-Modified", "ETag", "Set-Cookie"} {
				if v := resp.Header.Get(h); v != "" {
					w.Header().Set(h, v)
				}
			}
			w.WriteHeader(resp.StatusCode)
			if n > 0 {
				w.Write(buf[:n])
			}
			io.Copy(w, resp.Body)
			return
		}
	} else {
		body, _ = io.ReadAll(resp.Body)
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
		URL       string `json:"url"`
		TunerType string `json:"tuner_type"`
		Quality   string `json:"quality"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.URL == "" {
		http.Error(w, "url required", http.StatusBadRequest)
		return
	}

	if req.Quality == "" {
		req.Quality = "source"
	}

	sess, err := stream.Start(req.URL, req.TunerType, req.Quality)
	if err != nil {
		log.Printf("[stream] start error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"id":           sess.ID,
		"manifest_url": fmt.Sprintf("/api/stream/hls/%s/index.m3u8", sess.ID),
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

func heartbeatStreamHandler(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess := stream.GetSession(id)
	if sess == nil {
		http.Error(w, "stream not found", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusOK)
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
	if sess == nil && !strings.HasPrefix(id, "cam") {
		http.Error(w, "stream not found", http.StatusNotFound)
		return
	}
	targetFilename := filename
	targetURL := fmt.Sprintf("http://127.0.0.1:8888/%s/%s", id, targetFilename)
	if r.URL.RawQuery != "" {
		targetURL += "?" + r.URL.RawQuery
	}
	
	reqProxy, err := http.NewRequest("GET", targetURL, nil)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	
	for k, v := range r.Header {
		reqProxy.Header[k] = v
	}

	isManifest := filename == "index.m3u8" || filename == "stream.m3u8"
	isCamera := sess != nil && sess.TunerType == "rtsp"
	
	var client *http.Client
	if isCamera && isManifest {
		client = &http.Client{Timeout: 500 * time.Millisecond}
	} else {
		client = &http.Client{Timeout: 60 * time.Second}
	}

	var resp *http.Response
	if isManifest && !isCamera {
		// Wait up to ~15 seconds for MediaMTX to begin publishing (especially for remote HDHomeRun tuners)
		for i := 0; i < 30; i++ {
			resp, err = client.Do(reqProxy)
			if err == nil && resp.StatusCode == 200 {
				break
			}
			if resp != nil {
				resp.Body.Close()
			}
			time.Sleep(500 * time.Millisecond)
		}
	} else {
		resp, err = client.Do(reqProxy)
	}

	if err != nil || resp == nil || resp.StatusCode != 200 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	defer resp.Body.Close()

	for k, v := range resp.Header {
		w.Header()[k] = v
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func getSettingsHandler(w http.ResponseWriter, r *http.Request) {
	settings, err := db.GetAllSettings()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if settings == nil {
		settings = make(map[string]string)
	}
	// Defaults
	if _, ok := settings["epg_sync_time"]; !ok {
		settings["epg_sync_time"] = "03:00"
	}
	json.NewEncoder(w).Encode(settings)
}

func updateSettingsHandler(w http.ResponseWriter, r *http.Request) {
	var settings map[string]string
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	for k, v := range settings {
		db.SetSetting(k, v)
	}
	// Notify the background sync worker that settings changed
	ReloadSyncTimer()
	w.WriteHeader(http.StatusNoContent)
}
