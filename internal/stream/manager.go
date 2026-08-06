package stream

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Session struct {
	ID        string
	TunerType string
	Quality   string
	Dir       string
	URL       string
	CreatedAt time.Time
	LastUsed  time.Time
	mu        sync.Mutex
	ready     chan struct{}
	stopCh    chan struct{}
	stopped   bool
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
	dir := filepath.Join(os.TempDir(), "tvapp", id)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("mkdir: %w", err)
	}

	streamURL := rawURL
	if tunerType != "hdhomerun" {
		prefetchCookies(rawURL)
		streamURL = resolveStreamURL(rawURL)
	}
	log.Printf("[stream] %s resolved URL: %s", id, streamURL)

	sess := &Session{
		ID:        id,
		Dir:       dir,
		URL:       streamURL,
		TunerType: tunerType,
		Quality:   quality,
		CreatedAt: time.Now(),
		LastUsed:  time.Now(),
		ready:     make(chan struct{}),
		stopCh:    make(chan struct{}),
	}

	sessions.Store(id, sess)
	log.Printf("[stream] started %s", id)

	go sess.runLoop()
	go sess.waitForManifest()

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

func (s *Session) runLoop() {
	for {
		s.mu.Lock()
		if s.stopped {
			s.mu.Unlock()
			return
		}
		s.mu.Unlock()

		streamURL := s.URL

		videoArgs := []string{"-c:v", "copy"}
		if s.TunerType == "hdhomerun" {
			videoArgs = GetOptimalVideoArgs(s.Quality)
		}

		output := filepath.Join(s.Dir, "stream.m3u8")
		headers := ffmpegHeaders(streamURL)
		args := []string{
			"-user_agent", userAgent,
			"-headers", headers,
			"-err_detect", "ignore_err",
			"-analyzeduration", "1000000",
			"-probesize", "1000000",
			"-i", streamURL,
			"-sn",
		}
		args = append(args, videoArgs...)
		args = append(args,
			"-c:a", "aac",
			"-b:a", "128k",
			"-ac", "2",
			"-hls_time", "4",
			"-hls_list_size", "15",
			"-hls_init_time", "4",
			"-hls_flags", "delete_segments+append_list+independent_segments",
			"-loglevel", "warning",
			"-y",
			output,
		)

		cmd := exec.Command("ffmpeg", args...)
		cmd.Dir = s.Dir
		stderr, err := os.Create(filepath.Join(s.Dir, "ffmpeg.log"))
		if err != nil {
			log.Printf("[stream] %s log error: %v", s.ID, err)
			time.Sleep(2 * time.Second)
			continue
		}
		cmd.Stderr = stderr

		if err := cmd.Start(); err != nil {
			stderr.Close()
			log.Printf("[stream] %s ffmpeg start error: %v", s.ID, err)
			time.Sleep(2 * time.Second)
			continue
		}

		log.Printf("[stream] %s ffmpeg started (pid=%d)", s.ID, cmd.Process.Pid)
		log.Printf("[stream] %s ffmpeg headers: %s", s.ID, headers)

		done := make(chan error, 1)
		go func() {
			done <- cmd.Wait()
		}()

		select {
		case err := <-done:
			stderr.Close()
			log.Printf("[stream] %s ffmpeg exited: %v", s.ID, err)
		case <-s.stopCh:
			cmd.Process.Kill()
			stderr.Close()
			<-done
			log.Printf("[stream] %s ffmpeg killed", s.ID)
			return
		}

		time.Sleep(1 * time.Second)
	}
}

func (s *Session) waitForManifest() {
	manifest := filepath.Join(s.Dir, "stream.m3u8")
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(manifest); err == nil {
			close(s.ready)
			log.Printf("[stream] %s manifest ready", s.ID)
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
	log.Printf("[stream] %s manifest timeout", s.ID)
}

func (s *Session) WaitReady(timeout time.Duration) bool {
	select {
	case <-s.ready:
		return true
	case <-time.After(timeout):
		return false
	}
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
	s.mu.Lock()
	s.stopped = true
	s.mu.Unlock()
	close(s.stopCh)
	os.RemoveAll(s.Dir)
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
