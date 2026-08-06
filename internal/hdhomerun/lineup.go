package hdhomerun

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type Channel struct {
	GuideNumber string `json:"GuideNumber"`
	GuideName   string `json:"GuideName"`
	URL         string `json:"URL"`
}

func GetLineup(ipOrUrl string) ([]Channel, error) {
	target := ipOrUrl
	if !strings.HasPrefix(target, "http") {
		target = "http://" + target
	}
	if !strings.HasSuffix(target, "lineup.json") {
		target = strings.TrimSuffix(target, "/") + "/lineup.json"
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(target)
	if err != nil {
		return nil, fmt.Errorf("hdhomerun lineup request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var lineup []Channel
	if err := json.NewDecoder(resp.Body).Decode(&lineup); err != nil {
		return nil, fmt.Errorf("hdhomerun decode lineup: %w", err)
	}

	return lineup, nil
}
