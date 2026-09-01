package api

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"tvapp/internal/db"
	"tvapp/internal/stream"
)

var startTime = time.Now()

type ClientInfo struct {
	UserAgent string    `json:"user_agent"`
	LastSeen  time.Time `json:"last_seen"`
}

var (
	activeClients sync.Map
)

func formatUptime(d time.Duration) string {
	days := int(d.Hours() / 24)
	hours := int(math.Mod(d.Hours(), 24))
	minutes := int(math.Mod(d.Minutes(), 60))

	var parts []string
	if days > 0 {
		parts = append(parts, fmt.Sprintf("%dd", days))
	}
	if hours > 0 {
		parts = append(parts, fmt.Sprintf("%dh", hours))
	}
	parts = append(parts, fmt.Sprintf("%dm", minutes))
	
	return strings.Join(parts, " ")
}

func getSystemStats(w http.ResponseWriter, r *http.Request) {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	uptime := time.Since(startTime)
	uptimeStr := formatUptime(uptime)

	// Clean up old clients (not seen in 1 min)
	now := time.Now()
	clients := []string{}
	activeClients.Range(func(key, value interface{}) bool {
		info := value.(ClientInfo)
		if now.Sub(info.LastSeen) > time.Minute {
			activeClients.Delete(key)
		} else {
			clients = append(clients, info.UserAgent)
		}
		return true
	})

	dvrPath := db.GetSetting("dvr_path", "recordings")
	os.MkdirAll(dvrPath, 0755)
	
	absPath, _ := filepath.Abs(dvrPath)
	totalSpace, freeSpace, err := getDiskSpace(absPath)
	var diskTotalGB, diskFreeGB uint64
	if err == nil {
		diskTotalGB = totalSpace / 1024 / 1024 / 1024
		diskFreeGB = freeSpace / 1024 / 1024 / 1024
	}

	stats := map[string]interface{}{
		"goroutines":     runtime.NumGoroutine(),
		"memory_mb":      mem.Alloc / 1024 / 1024,
		"uptime":         uptimeStr,
		"active_streams": stream.GetActiveStreamCount(),
		"clients":        clients,
		"disk_total_gb":  diskTotalGB,
		"disk_free_gb":   diskFreeGB,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func clientPing(w http.ResponseWriter, r *http.Request) {
	ip := r.RemoteAddr
	ua := r.UserAgent()
	
	// Simplify common user agents
	simplifiedUA := "Unknown Device"
	uaLower := strings.ToLower(ua)
	if strings.Contains(uaLower, "tv") || strings.Contains(uaLower, "bravia") || strings.Contains(uaLower, "tizen") {
		simplifiedUA = "Smart TV"
	} else if strings.Contains(uaLower, "iphone") || strings.Contains(uaLower, "ipad") {
		simplifiedUA = "iOS App"
	} else if strings.Contains(uaLower, "android") {
		simplifiedUA = "Android App"
	} else if strings.Contains(uaLower, "chrome") {
		simplifiedUA = "Chrome"
	} else if strings.Contains(uaLower, "firefox") {
		simplifiedUA = "Firefox"
	} else if strings.Contains(uaLower, "safari") {
		simplifiedUA = "Safari"
	} else if strings.Contains(uaLower, "edge") {
		simplifiedUA = "Edge"
	}

	activeClients.Store(ip+"-"+simplifiedUA, ClientInfo{
		UserAgent: simplifiedUA,
		LastSeen:  time.Now(),
	})
	w.WriteHeader(http.StatusOK)
}

func exportDatabase(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Disposition", "attachment; filename=tvapp.db")
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, "tvapp.db")
}

func importDatabase(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(50 << 20); err != nil { // 50 MB limit
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("database")
	if err != nil {
		http.Error(w, "missing 'database' file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Safe to close current DB
	db.Close()

	// Overwrite the file
	out, err := os.Create("tvapp.db")
	if err != nil {
		http.Error(w, "failed to create db file", http.StatusInternalServerError)
		return
	}
	defer out.Close()

	if _, err := io.Copy(out, file); err != nil {
		http.Error(w, "failed to write db file", http.StatusInternalServerError)
		return
	}
	out.Close()

	// Re-initialize the DB
	if err := db.Init("tvapp.db"); err != nil {
		http.Error(w, "failed to re-initialize db: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success":true}`))
}

func wipeAllData(w http.ResponseWriter, r *http.Request) {
	if err := db.WipeAllData(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"success":true}`))
}
