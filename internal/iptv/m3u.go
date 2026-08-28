package iptv

import (
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type Channel struct {
	Name       string `json:"name"`
	StreamURL  string `json:"stream_url"`
	LogoURL    string `json:"logo_url,omitempty"`
	GroupTitle string `json:"group_title,omitempty"`
	TvgID      string `json:"tvg_id,omitempty"`
}

var (
	extinfRe  = regexp.MustCompile(`#EXTINF:-?\d+(?:\.\d+)?\s*(.*)`)
	tvgLogo   = regexp.MustCompile(`tvg-logo="([^"]*)"`)
	groupRe   = regexp.MustCompile(`group-title="([^"]*)"`)
	tvgIDRe   = regexp.MustCompile(`tvg-id="([^"]*)"`)
	channelID = regexp.MustCompile(`channel-id="([^"]*)"`)
)

func httpClient() *http.Client {
	return &http.Client{
		Timeout: 30 * time.Second,
	}
}

func ParseM3U(rawURL string) ([]Channel, string, error) {
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/plain, */*")
	req.Header.Set("Referer", "https://pluto.tv/")

	resp, err := httpClient().Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}

	channels, epgUrl := parseM3UContent(string(data))
	return channels, epgUrl, nil
}

func parseM3UContent(content string) ([]Channel, string) {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	var channels []Channel
	epgUrl := ""

	if len(lines) > 0 && strings.HasPrefix(lines[0], "#EXTM3U") {
		// Try to extract x-tvg-url
		idx := strings.Index(lines[0], `x-tvg-url="`)
		if idx != -1 {
			start := idx + 11
			end := strings.Index(lines[0][start:], `"`)
			if end != -1 {
				epgUrl = lines[0][start : start+end]
			}
		}
	}

	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if !strings.HasPrefix(line, "#EXTINF:") {
			continue
		}

		m := extinfRe.FindStringSubmatch(line)
		attrs := ""
		if len(m) > 1 {
			attrs = strings.TrimSpace(m[1])
		}

		name := ""
		if idx := strings.LastIndex(attrs, ","); idx != -1 {
			name = strings.TrimSpace(attrs[idx+1:])
		}

		logo := ""
		if m2 := tvgLogo.FindStringSubmatch(attrs); len(m2) > 1 {
			logo = m2[1]
		}

		group := ""
		if m3 := groupRe.FindStringSubmatch(attrs); len(m3) > 1 {
			group = m3[1]
		}

		tvgID := ""
		if m4 := tvgIDRe.FindStringSubmatch(attrs); len(m4) > 1 {
			tvgID = m4[1]
		}
		if tvgID == "" {
			if m5 := channelID.FindStringSubmatch(attrs); len(m5) > 1 {
				tvgID = m5[1]
			}
		}

		for j := i + 1; j < len(lines); j++ {
			next := strings.TrimSpace(lines[j])
			if next == "" || strings.HasPrefix(next, "#EXTINF:") {
				break
			}
			if !strings.HasPrefix(next, "#") {
				finalTvgID := tvgID
				if finalTvgID == "" {
					if idx := strings.Index(next, "plu-"); idx != -1 {
						parts := strings.Split(next[idx+4:], ".")
						if len(parts) > 0 {
							finalTvgID = parts[0]
						}
					}
				}

				channels = append(channels, Channel{
					Name:       name,
					StreamURL:  next,
					LogoURL:    logo,
					GroupTitle: group,
					TvgID:      finalTvgID,
				})
				i = j
				break
			}
		}
	}

	return channels, epgUrl
}
