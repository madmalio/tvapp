package epg

import (
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
	ID     string `xml:"id,attr"`
	Name   string `xml:"display-name"`
	Icon   *Icon  `xml:"icon,omitempty"`
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
	ChannelID   string    `json:"channel_id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	PosterURL   string    `json:"poster_url"`
	StartTime   time.Time `json:"start_time"`
	EndTime     time.Time `json:"end_time"`
}

func ParseXMLTV(rawURL string) ([]Entry, error) {
	resp, err := http.Get(rawURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
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
			ChannelID:   p.ChannelID,
			Title:       p.Title,
			Description: p.Description,
			PosterURL:   posterURL,
			StartTime:   start,
			EndTime:     end,
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
