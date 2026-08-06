package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"tvapp/internal/db"
	"tvapp/internal/epg"
	"tvapp/internal/hdhomerun"
	"tvapp/internal/iptv"
)

func getSourcesHandler(w http.ResponseWriter, r *http.Request) {
	sources, err := db.GetSources()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if sources == nil {
		sources = []db.SourceRow{}
	}
	json.NewEncoder(w).Encode(sources)
}

func addSourceHandler(w http.ResponseWriter, r *http.Request) {
	var s db.SourceRow
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if s.Name == "" || s.Type == "" || s.URL == "" {
		http.Error(w, "missing required fields", http.StatusBadRequest)
		return
	}

	if err := db.SaveSource(&s); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Trigger async parse
	go parseSource(s)

	json.NewEncoder(w).Encode(s)
}

func updateSourceHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	var s db.SourceRow
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	s.ID = id

	if err := db.UpdateSource(&s); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Re-parse
	go parseSource(s)

	json.NewEncoder(w).Encode(s)
}

func deleteSourceHandler(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	if err := db.DeleteSource(id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func parseSource(s db.SourceRow) {
	if s.Type == "iptv" {
		// Parse M3U
		iptvChannels, err := iptv.ParseM3U(s.URL)
		if err != nil {
			log.Printf("[source:%d] m3u parse failed: %v", s.ID, err)
			return
		}
		
		rows := make([]db.ChannelRow, len(iptvChannels))
		for i, ch := range iptvChannels {
			rows[i] = db.ChannelRow{
				SourceID:   s.ID,
				Name:       ch.Name,
				StreamURL:  ch.StreamURL,
				LogoURL:    ch.LogoURL,
				GroupTitle: ch.GroupTitle,
				TunerType:  "iptv",
				TvgID:      ch.TvgID,
			}
		}

		db.ClearChannelsForSource(s.ID)
		if err := db.SaveChannels(rows); err != nil {
			log.Printf("[source:%d] save channels failed: %v", s.ID, err)
			return
		}
		log.Printf("[source:%d] loaded %d channels", s.ID, len(rows))

		// Parse EPG if provided
		if s.EpgURL != "" {
			entries, err := epg.ParseXMLTV(s.EpgURL)
			if err != nil {
				log.Printf("[source:%d] epg parse failed: %v", s.ID, err)
				return
			}

			// We need fresh channels to map IDs
			savedChannels, _ := db.GetChannels()
			channelMap := make(map[string]int)
			for _, ch := range savedChannels {
				if ch.SourceID == s.ID && ch.TvgID != "" {
					channelMap[ch.TvgID] = ch.ID
				}
			}

			epgRows := []db.EPGEntryRow{}
			for _, e := range entries {
				if dbID, ok := channelMap[e.ChannelID]; ok {
					epgRows = append(epgRows, db.EPGEntryRow{
						ChannelID:   dbID,
						Title:       e.Title,
						Description: e.Description,
						PosterURL:   e.PosterURL,
						StartTime:   e.StartTime.Format(time.RFC3339),
						EndTime:     e.EndTime.Format(time.RFC3339),
					})
				}
			}

			db.ClearEPGEntriesForSource(s.ID)
			db.SaveEPGEntries(epgRows)
			log.Printf("[source:%d] loaded %d epg entries", s.ID, len(epgRows))
		}
	} else if s.Type == "hdhomerun" {
		// Fetch lineup from IP
		channels, err := hdhomerun.GetLineup(s.URL)
		if err != nil {
			log.Printf("[source:%d] hdhomerun lineup failed: %v", s.ID, err)
			return
		}
		
		rows := make([]db.ChannelRow, len(channels))
		for i, ch := range channels {
			rows[i] = db.ChannelRow{
				SourceID:   s.ID,
				Name:       ch.GuideName,
				StreamURL:  ch.URL,
				GroupTitle: "HDHomeRun",
				TunerType:  "hdhomerun",
			}
		}

		db.ClearChannelsForSource(s.ID)
		db.SaveChannels(rows)
		log.Printf("[source:%d] loaded %d hdhomerun channels", s.ID, len(rows))
	}
}
