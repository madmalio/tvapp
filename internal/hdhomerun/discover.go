package hdhomerun

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type Device struct {
	ID            string `json:"id"`
	IP            string `json:"ip"`
	Model         string `json:"model"`
	Firmware      string `json:"firmware"`
	TunerCount    int    `json:"tuner_count"`
	BaseURL       string `json:"base_url"`
	DeviceType    string `json:"device_type"`
	DiscoverURL   string `json:"discover_url"`
	LineupURL     string `json:"lineup_url"`
	DeviceAuth    string `json:"device_auth"`
}

const discoverURL = "http://discover.hdhomerun.com/discover"

// GetDeviceAuth fetches the discover.json directly from the device's local IP to get the DeviceAuth string
func GetDeviceAuth(ctx context.Context, deviceIP string) (string, error) {
	target := deviceIP
	if !strings.HasPrefix(target, "http") {
		target = "http://" + target
	}
	if !strings.HasSuffix(target, "discover.json") {
		target = strings.TrimSuffix(target, "/") + "/discover.json"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return "", err
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("local discover request failed: %w", err)
	}
	defer resp.Body.Close()

	var data struct {
		DeviceAuth string `json:"DeviceAuth"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", fmt.Errorf("decode local discover: %w", err)
	}

	if data.DeviceAuth == "" {
		return "", fmt.Errorf("device did not return DeviceAuth")
	}

	return data.DeviceAuth, nil
}

func Discover(ctx context.Context) ([]Device, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, discoverURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("hdhomerun discover request: %w", err)
	}
	defer resp.Body.Close()

	var raw []struct {
		ID           string `json:"DeviceID"`
		IP           string `json:"LocalIP"`
		Model        string `json:"ModelNumber"`
		Firmware     string `json:"FirmwareName"`
		TunerCount   int    `json:"TunerCount"`
		DeviceType   string `json:"DeviceType"`
		BaseURL      string `json:"BaseURL"`
		DiscoverURL  string `json:"DiscoverURL"`
		LineupURL    string `json:"LineupURL"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("hdhomerun decode: %w", err)
	}

	devices := make([]Device, 0, len(raw))
	for _, d := range raw {
		devices = append(devices, Device{
			ID:          d.ID,
			IP:          d.IP,
			Model:       d.Model,
			Firmware:    d.Firmware,
			TunerCount:  d.TunerCount,
			DeviceType:  d.DeviceType,
			BaseURL:     d.BaseURL,
			DiscoverURL: d.DiscoverURL,
			LineupURL:   d.LineupURL,
		})
	}

	if len(devices) == 0 {
		return nil, fmt.Errorf("no HDHomeRun devices found")
	}

	return devices, nil
}
