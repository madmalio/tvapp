package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
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

func updateSourceOrderHandler(w http.ResponseWriter, r *http.Request) {
	var ids []int
	if err := json.NewDecoder(r.Body).Decode(&ids); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	if err := db.UpdateSourceOrder(ids); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
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

		if err := db.SyncChannels(s.ID, rows); err != nil {
			log.Printf("[source:%d] sync channels failed: %v", s.ID, err)
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
				TvgID:      ch.GuideNumber,
			}
		}

		if err := db.SyncChannels(s.ID, rows); err != nil {
			log.Printf("[source:%d] sync channels failed: %v", s.ID, err)
			return
		}
		log.Printf("[source:%d] loaded %d hdhomerun channels", s.ID, len(rows))

		// Try fetching EPG
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		auth, err := hdhomerun.GetDeviceAuth(ctx, s.URL)
		if err != nil {
			log.Printf("[source:%d] no device auth (no guide sub or timeout): %v", s.ID, err)
			return
		}

		epgURL := "https://api.hdhomerun.com/api/xmltv?DeviceAuth=" + auth
		entries, err := epg.ParseXMLTV(epgURL)
		if err != nil {
			log.Printf("[source:%d] hdhomerun epg failed: %v", s.ID, err)
			return
		}

		// Map channels back to IDs (XMLTV uses GuideNumber or GuideName for ChannelID)
		savedChannels, _ := db.GetChannels()

		epgRows := []db.EPGEntryRow{}
		channelUpdates := make(map[int]*db.ChannelRow)

		for _, e := range entries {
			var dbID int
			var ok bool

			// Find matching channel. XMLTV display-names often look like "11.1 KCHFDT"
			for _, c := range savedChannels {
				if c.SourceID != s.ID {
					continue
				}

				// Exact match on raw ID
				if e.ChannelID == c.TvgID || e.ChannelID == c.Name {
					dbID = c.ID
					ok = true
					break
				}

				// Search display names for exact match or correct prefix (e.g. "11.1" in "11.1 KCHFDT")
				for _, dName := range e.ChannelNames {
					if dName == c.Name || dName == c.TvgID {
						dbID = c.ID
						ok = true
						break
					}
					// Display names are often like "11.1 KCHFDT" or "11.1". We want to strictly match the guide number.
					if c.TvgID != "" {
						parts := strings.Split(dName, " ")
						if len(parts) > 0 && parts[0] == c.TvgID {
							dbID = c.ID
							ok = true
							break
						}
					}
				}
				if ok {
					break
				}
			}

			if ok {
				// Save EPG Entry
				epgRows = append(epgRows, db.EPGEntryRow{
					ChannelID:   dbID,
					Title:       e.Title,
					Description: e.Description,
					PosterURL:   e.PosterURL,
					StartTime:   e.StartTime.Format(time.RFC3339),
					EndTime:     e.EndTime.Format(time.RFC3339),
				})

				// Extract Logo and Category from XMLTV to enrich the Channel
				ch, exists := channelUpdates[dbID]
				if !exists {
					for _, c := range savedChannels {
						if c.ID == dbID {
							copy := c
							channelUpdates[dbID] = &copy
							ch = &copy
							break
						}
					}
				}

				if ch != nil {
					if e.ChannelLogo != "" && ch.LogoURL == "" {
						ch.LogoURL = e.ChannelLogo
					}
					
					// Scan XMLTV DisplayNames for Affiliate network (NBC, ABC, CBS, etc.)
					for _, name := range e.ChannelNames {
						upper := strings.ToUpper(name)
						if upper == "NBC" || upper == "ABC" || upper == "CBS" || upper == "FOX" || upper == "CW" || upper == "PBS" || upper == "ION" {
							// If the channel name doesn't already contain the affiliate, append it
							if !strings.Contains(strings.ToUpper(ch.Name), upper) {
								ch.Name = fmt.Sprintf("%s (%s)", ch.Name, upper)
							}
							ch.GroupTitle = "Local"
							break
						}
					}
				}
			}
		}

		var channelsToUpdate []db.ChannelRow
		for _, ch := range channelUpdates {
			if ch.LogoURL != "" || ch.GroupTitle != "HDHomeRun" {
				channelsToUpdate = append(channelsToUpdate, *ch)
			}
		}

		if len(channelsToUpdate) > 0 {
			db.UpdateChannels(channelsToUpdate)
			log.Printf("[source:%d] updated %d channels with xmltv metadata", s.ID, len(channelsToUpdate))
		}

		db.ClearEPGEntriesForSource(s.ID)
		db.SaveEPGEntries(epgRows)
		log.Printf("[source:%d] loaded %d hdhomerun epg entries", s.ID, len(epgRows))
	}
}

var (
	lastGlobalSync time.Time
	syncMu         sync.Mutex
)

// TriggerGlobalSync runs a background sync of all sources if more than 12 hours have passed since the last sync.
func TriggerGlobalSync() {
	syncMu.Lock()
	defer syncMu.Unlock()

	if time.Since(lastGlobalSync) < 12*time.Hour {
		return
	}
	
	// If it's the absolute first boot, give the server 10 seconds to fully spin up
	// before locking the DB, to ensure the frontend loads instantly.
	isFirstBoot := lastGlobalSync.IsZero()
	lastGlobalSync = time.Now()

	go func() {
		if isFirstBoot {
			time.Sleep(10 * time.Second)
		}
		
		log.Println("[sync] performing background source sync...")
		if sources, err := db.GetSources(); err == nil {
			for _, s := range sources {
				parseSource(s)
			}
		}
	}()
}
