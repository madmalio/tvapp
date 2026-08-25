package stream

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Session struct {
	ID        string
	TunerType string
	Quality   string
	RawURL    string
	URL       string
	CreatedAt time.Time
	LastUsed  time.Time
	mu        sync.Mutex
}

var (
	sessions        sync.Map
	cleanupInterval = 60 * time.Second
	streamJar       http.CookieJar
)

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

func init() {
	streamJar, _ = cookiejar.New(nil)
	go cleanupLoop()
}

func prefetchCookies(rawURL string) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return
	}
	req, _ := http.NewRequest("GET", rawURL, nil)
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Referer", u.Scheme+"://"+u.Host+"/")
	client := &http.Client{Jar: streamJar}
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	resp.Body.Close()
}

func ffmpegHeaders(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		u = &url.URL{Scheme: "https", Host: "pluto.tv"}
	}
	referer := u.Scheme + "://" + u.Host + "/"
	origin := u.Scheme + "://" + u.Host

	cookies := streamJar.Cookies(u)
	cookieStr := ""
	for _, c := range cookies {
		cookieStr += c.String() + "; "
	}

	return fmt.Sprintf("User-Agent: %s\r\nReferer: %s\r\nOrigin: %s\r\nCookie: %s\r\n", userAgent, referer, origin, cookieStr)
}

func Start(rawURL string, tunerType string, quality string) (*Session, error) {
	id := fmt.Sprintf("stream_%d", time.Now().UnixNano())

	streamURL := rawURL
	if tunerType != "hdhomerun" && tunerType != "rtsp" {
		prefetchCookies(rawURL)
		streamURL = resolveStreamURL(rawURL)
	}
	log.Printf("[stream] %s resolved URL: %s", id, streamURL)

	sess := &Session{
		ID:        id,
		RawURL:    rawURL,
		URL:       streamURL,
		TunerType: tunerType,
		Quality:   quality,
		CreatedAt: time.Now(),
		LastUsed:  time.Now(),
	}

	sessions.Store(id, sess)

	// Build go2rtc src string
	var src string
	if tunerType == "rtsp" {
		src = streamURL
	} else if tunerType == "hdhomerun" {
		// HDHomeRun produces MPEG-TS. Transcode to H264 for universal playback.
		src = fmt.Sprintf("ffmpeg:%s#video=h264#audio=opus", streamURL)
	} else {
		// PlutoTV / IPTV (usually H264/AAC inside HLS or MPEG-TS)
		src = fmt.Sprintf("ffmpeg:%s#video=copy#audio=copy", streamURL)
	}

	// Register main stream
	putURL := fmt.Sprintf("http://127.0.0.1:1984/api/streams?name=%s&src=%s", id, url.QueryEscape(src))
	req, _ := http.NewRequest("PUT", putURL, nil)
	if resp, err := http.DefaultClient.Do(req); err == nil {
		resp.Body.Close()
	} else {
		log.Printf("[stream] failed to register stream %s with go2rtc: %v", id, err)
	}

	// For cameras, register _sd companion stream
	if tunerType == "rtsp" {
		sdSrc := fmt.Sprintf("ffmpeg:%s#video=h264#width=640", id)
		putSDURL := fmt.Sprintf("http://127.0.0.1:1984/api/streams?name=%s_sd&src=%s", id, url.QueryEscape(sdSrc))
		reqSD, _ := http.NewRequest("PUT", putSDURL, nil)
		if resp, err := http.DefaultClient.Do(reqSD); err == nil {
			resp.Body.Close()
		} else {
			log.Printf("[stream] failed to register SD stream %s with go2rtc: %v", id, err)
		}
	}

	log.Printf("[stream] started %s (go2rtc)", id)
	return sess, nil
}

func resolveStreamURL(rawURL string) string {
	client := &http.Client{Timeout: 15 * time.Second, Jar: streamJar}
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return rawURL
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "*/*")
	if u, err := url.Parse(rawURL); err == nil {
		req.Header.Set("Referer", u.Scheme+"://"+u.Host+"/")
	}

	resp, err := client.Do(req)
	if err != nil {
		return rawURL
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil || !bytes.HasPrefix(body, []byte("#EXTM3U")) {
		return rawURL
	}

	if !bytes.Contains(body, []byte("#EXT-X-STREAM-INF:")) {
		return rawURL
	}

	lines := strings.Split(string(body), "\n")
	finalURL := resp.Request.URL
	var bestURL string
	var maxBW int

	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if !strings.HasPrefix(line, "#EXT-X-STREAM-INF:") {
			continue
		}
		bw := parseHLSBandwidth(line)
		if i+1 < len(lines) {
			next := strings.TrimSpace(lines[i+1])
			if next != "" && !strings.HasPrefix(next, "#") {
				resolved := resolveHLSURL(finalURL, next)
				if bw >= maxBW {
					maxBW = bw
					bestURL = resolved
				}
			}
		}
	}

	if bestURL == "" {
		return rawURL
	}
	return bestURL
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

func GetSession(id string) *Session {
	v, ok := sessions.Load(id)
	if !ok {
		return nil
	}
	s := v.(*Session)
	s.mu.Lock()
	s.LastUsed = time.Now()
	s.mu.Unlock()
	return s
}

func Stop(id string) {
	v, ok := sessions.LoadAndDelete(id)
	if !ok {
		return
	}
	s := v.(*Session)

	// Delete from go2rtc
	delURL := fmt.Sprintf("http://127.0.0.1:1984/api/streams?src=%s", id)
	req, _ := http.NewRequest("DELETE", delURL, nil)
	if resp, err := http.DefaultClient.Do(req); err == nil {
		resp.Body.Close()
	}

	if s.TunerType == "rtsp" {
		delSDURL := fmt.Sprintf("http://127.0.0.1:1984/api/streams?src=%s_sd", id)
		reqSD, _ := http.NewRequest("DELETE", delSDURL, nil)
		if resp, err := http.DefaultClient.Do(reqSD); err == nil {
			resp.Body.Close()
		}
	}

	log.Printf("[stream] stopped %s", id)
}

func cleanupLoop() {
	for {
		time.Sleep(cleanupInterval)
		now := time.Now()
		sessions.Range(func(key, value interface{}) bool {
			s := value.(*Session)
			s.mu.Lock()
			last := s.LastUsed
			s.mu.Unlock()
			if now.Sub(last) > 120*time.Second {
				log.Printf("[stream] cleanup: %s (idle %v)", key.(string), now.Sub(last))
				Stop(key.(string))
			}
			return true
		})
	}
}
