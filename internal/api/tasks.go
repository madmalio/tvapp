package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"tvapp/internal/db"

	"github.com/go-chi/chi/v5"
)

type PackageTask struct {
	ID       string `json:"id"`
	Status   string `json:"status"` // processing, completed, failed
	Progress int    `json:"progress"`
	TempFile string `json:"-"`
	Error    string `json:"error,omitempty"`
}

var (
	tasks   = make(map[string]*PackageTask)
	tasksMu sync.Mutex
)

func packageRecordingHandler(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	rec, err := db.GetRecording(id)
	if err != nil || rec.FilePath == "" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	// If it's already an MP4, instantly return completed
	if strings.HasSuffix(rec.FilePath, ".mp4") {
		taskID := fmt.Sprintf("task_%d_%d", id, time.Now().UnixNano())
		tasksMu.Lock()
		tasks[taskID] = &PackageTask{
			ID:       taskID,
			Status:   "completed",
			Progress: 100,
			TempFile: rec.FilePath, // Use the original file since it's already mp4
		}
		tasksMu.Unlock()
		json.NewEncoder(w).Encode(map[string]string{"taskId": taskID})
		return
	}

	taskID := fmt.Sprintf("task_%d_%d", id, time.Now().UnixNano())
	
tmpDir := filepath.Join(filepath.Dir(rec.FilePath), "tmp")
	os.MkdirAll(tmpDir, 0755)
	safeTitle := strings.ReplaceAll(rec.Title, " ", "_")
	safeTitle = strings.ReplaceAll(safeTitle, "/", "-")
	tmpFile := filepath.Join(tmpDir, fmt.Sprintf("%s_%d.mp4", safeTitle, id))

	tasksMu.Lock()
	tasks[taskID] = &PackageTask{
		ID:       taskID,
		Status:   "processing",
		TempFile: tmpFile,
	}
	tasksMu.Unlock()

	go func() {
		cmd := exec.Command("ffmpeg", "-i", rec.FilePath, "-c", "copy", "-movflags", "+faststart", "-y", tmpFile)
		err := cmd.Run()
		
		tasksMu.Lock()
		if err != nil {
			tasks[taskID].Status = "failed"
			tasks[taskID].Error = err.Error()
		} else {
			tasks[taskID].Status = "completed"
			tasks[taskID].Progress = 100
		}
		tasksMu.Unlock()
	}()

	json.NewEncoder(w).Encode(map[string]string{"taskId": taskID})
}

func getTaskStatusHandler(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "id")
	tasksMu.Lock()
	task, exists := tasks[taskID]
	tasksMu.Unlock()

	if !exists {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(task)
}

func downloadTaskHandler(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "id")
	tasksMu.Lock()
	task, exists := tasks[taskID]
	tasksMu.Unlock()

	if !exists || task.Status != "completed" {
		http.Error(w, "not found or not completed", http.StatusNotFound)
		return
	}

	filename := filepath.Base(task.TempFile)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	w.Header().Set("Content-Type", "video/mp4")
	http.ServeFile(w, r, task.TempFile)
}

func init() {
	// Background cleanup routine
	go func() {
		for {
			time.Sleep(1 * time.Hour)
			// Delete old task states
			tasksMu.Lock()
			for k, v := range tasks {
				if v.Status == "completed" || v.Status == "failed" {
					delete(tasks, k)
				}
			}
			tasksMu.Unlock()
			
			// Hard cleanup of /tmp directory in recordings (needs DB context, maybe just find all /tmp dirs)
		}
	}()
}
