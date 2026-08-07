package epg

import (
	"compress/gzip"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"time"
)

type TV struct {
	XMLName  xml.Name  `xml:"tv"`
	Channels []Channel `xml:"channel"`
	Programs []Program `xml:"programme"`
}

type Channel struct {
	ID          string   `xml:"id,attr"`
	DisplayName []string `xml:"display-name"`
	Icon        *Icon    `xml:"icon,omitempty"`
}

type Icon struct {
	Src string `xml:"src,attr"`
}

type Program struct {
	ChannelID   string      `xml:"channel,attr"`
	Start       string      `xml:"start,attr"`
	Stop        string      `xml:"stop,attr"`
	Title       string      `xml:"title"`
	SubTitle    string      `xml:"sub-title,omitempty"`
	Description string      `xml:"desc,omitempty"`
	Category    string      `xml:"category,omitempty"`
	Icon        *Icon       `xml:"icon,omitempty"`
}

type Entry struct {
	ChannelID    string    `json:"channel_id"`
	ChannelNames []string  `json:"channel_names"`
	ChannelLogo  string    `json:"channel_logo"`
	Category     string    `json:"category"`
	Title        string    `json:"title"`
	Description  string    `json:"description"`
	PosterURL    string    `json:"poster_url"`
	StartTime    time.Time `json:"start_time"`
	EndTime      time.Time `json:"end_time"`
}

func ParseXMLTV(rawURL string) ([]Entry, error) {
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	// Accept gzip encoding for large XMLTV files
	req.Header.Set("Accept-Encoding", "gzip")
	// Many EPG providers (including SiliconDust) block default Go HTTP clients
	req.Header.Set("User-Agent", "TVApp/1.0 (Mozilla/5.0)")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("xmltv server returned status: %d", resp.StatusCode)
	}

	var reader io.Reader = resp.Body
	if resp.Header.Get("Content-Encoding") == "gzip" {
		gz, err := gzip.NewReader(resp.Body)
		if err != nil {
			return nil, err
		}
		defer gz.Close()
		reader = gz
	}

	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}

	return parseXMLTVContent(data)
}

func parseXMLTVContent(data []byte) ([]Entry, error) {
	var tv TV
	if err := xml.Unmarshal(data, &tv); err != nil {
		return nil, fmt.Errorf("xmltv unmarshal: %w", err)
	}

	channelNames := make(map[string][]string)
	channelLogos := make(map[string]string)
	for _, ch := range tv.Channels {
		channelNames[ch.ID] = ch.DisplayName
		if ch.Icon != nil {
			channelLogos[ch.ID] = ch.Icon.Src
		}
	}

	var entries []Entry
	for _, p := range tv.Programs {
		start, err := parseXMLTVTime(p.Start)
		if err != nil {
			continue
		}
		end, err := parseXMLTVTime(p.Stop)
		if err != nil {
			continue
		}

		var posterURL string
		if p.Icon != nil {
			posterURL = p.Icon.Src
		}

		entries = append(entries, Entry{
			ChannelID:    p.ChannelID,
			ChannelNames: channelNames[p.ChannelID],
			ChannelLogo:  channelLogos[p.ChannelID],
			Category:     p.Category,
			Title:        p.Title,
			Description:  p.Description,
			PosterURL:    posterURL,
			StartTime:    start.UTC(),
			EndTime:      end.UTC(),
		})
	}

	return entries, nil
}

func parseXMLTVTime(s string) (time.Time, error) {
	format := "20060102150405 -0700"
	if len(s) < 14 {
		return time.Time{}, fmt.Errorf("invalid xmltv time: %s", s)
	}
	t := s[:14]
	var offset string
	if len(s) > 14 {
		offset = s[14:]
	}
	if offset == "" {
		offset = " +0000"
	}
	return time.Parse(format, t+offset)
}
