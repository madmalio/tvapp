package hdhomerun

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type GuideChannel struct {
	GuideNumber string         `json:"GuideNumber"`
	GuideName   string         `json:"GuideName"`
	Affiliate   string         `json:"Affiliate"`
	Programs    []GuideProgram `json:"Programs"`
}

type GuideProgram struct {
	Title        string `json:"Title"`
	EpisodeTitle string `json:"EpisodeTitle"`
	Synopsis     string `json:"Synopsis"`
	ImageURL     string `json:"ImageURL"`
	StartTime    int64  `json:"StartTime"`
	EndTime      int64  `json:"EndTime"`
}

const guideAPIURL = "https://my.hdhomerun.com/api/guide.php"

func FetchEPG(ctx context.Context, deviceAuth string) ([]GuideChannel, error) {
	if deviceAuth == "" {
		return nil, fmt.Errorf("DeviceAuth is required")
	}

	url := fmt.Sprintf("%s?DeviceAuth=%s", guideAPIURL, deviceAuth)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	
	// SiliconDust blocks default Go-http-client with 403 Forbidden
	req.Header.Set("User-Agent", "TVApp/1.0 (Mozilla/5.0)")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("hdhomerun guide request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status from guide api: %d", resp.StatusCode)
	}

	var guide []GuideChannel
	if err := json.NewDecoder(resp.Body).Decode(&guide); err != nil {
		return nil, fmt.Errorf("failed to decode guide json: %w", err)
	}

	return guide, nil
}
