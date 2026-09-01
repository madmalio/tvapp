package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"tvapp/internal/db"
	"tvapp/internal/dvr"
	"tvapp/internal/stream"

	"github.com/go-chi/chi/v5"
)

func getProfileID(r *http.Request) int {
	pidStr := r.Header.Get("X-Profile-ID")
	pid, err := strconv.Atoi(pidStr)
	if err != nil || pid <= 0 {
		return 1 // Default to profile 1
	}
	return pid
}

func getRecordings(w http.ResponseWriter, r *http.Request) {
	pid := getProfileID(r)
	recordings, err := db.GetRecordings(pid)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if recordings == nil {
		recordings = []db.RecordingRow{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(recordings)
}

func getRecording(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	rec, err := db.GetRecording(id)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rec)
}

func addRecording(w http.ResponseWriter, r *http.Request) {
	var rec db.RecordingRow
	if err := json.NewDecoder(r.Body).Decode(&rec); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if rec.Status == "" {
		rec.Status = "scheduled"
	}
	rec.ProfileID = getProfileID(r)
	if err := db.SaveRecording(&rec); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Instantly start it if it should be running now (allow 2 mins of clock skew)
	if rec.Status == "scheduled" {
		start, _ := time.Parse(time.RFC3339, rec.StartTime)
		if start.Before(time.Now().Add(2 * time.Minute)) {
			end, _ := time.Parse(time.RFC3339, rec.EndTime)
			go dvr.StartRecording(rec, start, end)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rec)
}

func deleteRecording(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	rec, err := db.GetRecording(id)
	if err == nil {
		// Stop any active ffmpeg process
		stream.StopRecording(id)

		// Always reconstruct the filepath since DB might be empty if it failed or was in-progress
		safeTitle := strings.ReplaceAll(rec.Title, " ", "_")
		safeTitle = strings.ReplaceAll(safeTitle, "/", "-")
		base := fmt.Sprintf("%s_%d", safeTitle, id)
		dir := "recordings"

		files, _ := os.ReadDir(dir)
		for _, f := range files {
			if strings.HasPrefix(f.Name(), base) {
				os.Remove(filepath.Join(dir, f.Name()))
			}
		}
	}

	if err := db.DeleteRecording(id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func stopRecording(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	stream.StopRecording(id)

	w.WriteHeader(http.StatusOK)
}
