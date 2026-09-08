package dvr

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"tvapp/internal/db"
	"tvapp/internal/stream"
)

var (
	recordingsDir = "recordings"
)

func Init() {
	go runScheduler()
}

func runScheduler() {
	ticker := time.NewTicker(30 * time.Second)
	for range ticker.C {
		checkRecordings()
	}
}

func checkRecordings() {
	recs, err := db.GetAllRecordings()
	if err != nil {
		log.Printf("[dvr] failed to get recordings: %v", err)
		return
	}

	now := time.Now()

	prePaddingStr := db.GetSetting("pre_padding", "0")
	prePadMins, _ := strconv.Atoi(prePaddingStr)
	
	for _, r := range recs {
		if r.Status != "scheduled" {
			continue
		}

		startTime, err := time.Parse(time.RFC3339, r.StartTime)
		if err != nil {
			log.Printf("[dvr] invalid start time %s: %v", r.StartTime, err)
			continue
		}
		
		adjustedStartTime := startTime.Add(-time.Duration(prePadMins) * time.Minute)

		if now.After(adjustedStartTime) || adjustedStartTime.Sub(now) < 30*time.Second {
			endTime, err := time.Parse(time.RFC3339, r.EndTime)
			if err != nil {
				log.Printf("[dvr] invalid end time %s: %v", r.EndTime, err)
				continue
			}
			
			postPaddingStr := db.GetSetting("post_padding", "0")
			postPadMins, _ := strconv.Atoi(postPaddingStr)
			adjustedEndTime := endTime.Add(time.Duration(postPadMins) * time.Minute)

			if now.After(adjustedEndTime) {
				log.Printf("[dvr] missed recording %d: %s", r.ID, r.Title)
				db.UpdateRecordingStatus(r.ID, "failed", "")
				continue
			}

			go StartRecording(r, adjustedStartTime, adjustedEndTime)
		}
	}
}

func StartRecording(r db.RecordingRow, start, end time.Time) {
	db.UpdateRecordingStatus(r.ID, "recording", "")

	ch, err := db.GetChannel(r.ChannelID)
	if err != nil {
		log.Printf("[dvr] failed to get channel for recording %d: %v", r.ID, err)
		db.UpdateRecordingStatus(r.ID, "failed", "")
		return
	}

	durationSec := int(end.Sub(time.Now()).Seconds())
	if durationSec <= 0 {
		durationSec = 60
	}

	safeTitle := strings.ReplaceAll(r.Title, " ", "_")
	safeTitle = strings.ReplaceAll(safeTitle, "/", "-")
	
	ext := ".m3u8"
	filename := fmt.Sprintf("%s_%d%s", safeTitle, r.ID, ext)
	
	dvrPath := db.GetSetting("dvr_path", "recordings")
	outputFile := filepath.Join(dvrPath, filename)

	err = stream.RecordStream(r.ID, ch.StreamURL, ch.TunerType, durationSec, outputFile)
	if err != nil {
		log.Printf("[dvr] recording %d failed: %v", r.ID, err)
		db.UpdateRecordingStatus(r.ID, "failed", "")
		return
	}

	if _, err := os.Stat(outputFile); os.IsNotExist(err) {
		log.Printf("[dvr] recording file %s was not created (recording may have been stopped too quickly)", outputFile)
		db.UpdateRecordingStatus(r.ID, "failed", "File not created")
		return
	}

	db.UpdateRecordingStatus(r.ID, "completed", outputFile)
}
