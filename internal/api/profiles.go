package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"tvapp/internal/db"
)

func getProfilesHandler(w http.ResponseWriter, r *http.Request) {
	profiles, err := db.GetProfiles()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if profiles == nil {
		profiles = []db.ProfileRow{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profiles)
}

func addProfileHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url"`
		IsAdmin   bool   `json:"is_admin"`
		Pin       string `json:"pin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	p := db.ProfileRow{
		Name:      req.Name,
		AvatarURL: req.AvatarURL,
		IsAdmin:   req.IsAdmin,
		Pin:       req.Pin,
	}
	if err := db.SaveProfile(&p); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	p.HasPin = (p.Pin != "")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(p)
}

func setupAdminHandler(w http.ResponseWriter, r *http.Request) {
	profiles, _ := db.GetProfiles()
	if len(profiles) > 0 {
		http.Error(w, "Setup already completed", http.StatusForbidden)
		return
	}
	// Force the first profile to be admin
	var req struct {
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url"`
		Pin       string `json:"pin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	p := db.ProfileRow{
		Name:      req.Name,
		AvatarURL: req.AvatarURL,
		IsAdmin:   true,
		Pin:       req.Pin,
	}
	if err := db.SaveProfile(&p); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	p.HasPin = (p.Pin != "")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(p)
}

func updateProfileHandler(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var req struct {
		Name      string `json:"name"`
		AvatarURL string `json:"avatar_url"`
		IsAdmin   bool   `json:"is_admin"`
		Pin       string `json:"pin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	
	// If PIN is not provided in update, we probably want to keep the old one?
	// The frontend will send the new pin if changing it.
	// For simplicity, let's fetch the existing profile to merge the PIN if needed.
	existing, err := db.GetProfile(id)
	if err != nil {
		http.Error(w, "profile not found", http.StatusNotFound)
		return
	}
	
	p := db.ProfileRow{
		ID:        id,
		Name:      req.Name,
		AvatarURL: req.AvatarURL,
		IsAdmin:   req.IsAdmin,
		Pin:       req.Pin,
	}
	
	// If the frontend didn't send a pin, maybe they didn't want to change it?
	// But if they want to clear it, how? Let's say if it's explicitly sent.
	// Actually, the frontend will send it if they update it. If they don't, we should preserve it.
	// We'll trust the frontend to send the exact intended state. Wait, frontend doesn't know the PIN.
	// Let's implement a specific logic: if the frontend sends `pin: "****"`, it means keep existing.
	if p.Pin == "****" {
		p.Pin = existing.Pin
	}

	if err := db.UpdateProfile(&p); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	p.HasPin = (p.Pin != "")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(p)
}

func deleteProfileHandler(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	if err := db.DeleteProfile(id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
