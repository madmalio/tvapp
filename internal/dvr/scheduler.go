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
	if ch.TunerType == "hdhomerun" {
		ext = ".ts"
	}

	filename := fmt.Sprintf("%s_%d%s", safeTitle, r.ID, ext)
	
	dvrPath := db.GetSetting("dvr_path", "recordings")
	recordingDir := filepath.Join(dvrPath, safeTitle)
	os.MkdirAll(recordingDir, 0755)

	outputFile := filepath.Join(recordingDir, filename)

	err = stream.RecordStream(r.ID, ch.StreamURL, ch.TunerType, durationSec, outputFile)
	if err != nil {
		log.Printf("[dvr] recording %d failed: %v", r.ID, err)
		db.UpdateRecordingStatus(r.ID, "failed", "")
		return
	}

	dir := filepath.Dir(outputFile)
	base := strings.TrimSuffix(filepath.Base(outputFile), filepath.Ext(outputFile))
	
	files, _ := os.ReadDir(dir)
	var tsFiles []string
	for _, f := range files {
		if strings.HasPrefix(f.Name(), base) && strings.HasSuffix(f.Name(), ".ts") {
			info, err := f.Info()
			if err == nil && info.Size() > 1024 { // filter out empty chunks from EXT-X-GAP restarts
				tsFiles = append(tsFiles, f.Name())
			} else {
				os.Remove(filepath.Join(dir, f.Name()))
			}
		}
	}

	_, errM3u8 := os.Stat(outputFile)
	if len(tsFiles) == 0 && os.IsNotExist(errM3u8) {
		log.Printf("[dvr] recording file(s) for %s were not created (recording may have been stopped too quickly)", base)
		db.UpdateRecordingStatus(r.ID, "failed", "Files not created")
		return
	}

	// Package the HLS chunks into a gapless MP4 using the concat demuxer.
	// This natively rewrites PTS timestamps across ad gaps, resulting in a perfect MP4 without transcoding!
	mp4Filename := fmt.Sprintf("%s_%d.mp4", safeTitle, r.ID)
	mp4OutputFile := filepath.Join(recordingDir, mp4Filename)
	
	if ch.TunerType == "hdhomerun" {
		db.UpdateRecordingStatus(r.ID, "processing", "")
		log.Printf("[dvr] transcoding raw HDHomeRun TS to MP4 (this may take a while)...")
		
		// Use dedicated offline transcode arguments instead of live-streaming args to guarantee smooth playback
		cmdArgs := []string{
			"-fflags", "+genpts",
			"-ss", "2", // Input seeking is required to actually skip the broken frames before decoding starts
			"-i", outputFile,
			"-async", "1", // Use classic async to stretch/squeeze audio to match video timestamps
			"-fps_mode", "cfr",
			"-c:v", "libx264",
			"-preset", "veryfast", // Slower than ultrafast, but compresses much better (smaller file, lower bitrate)
			"-crf", "25", // Slightly lower quality to reduce bitrate
			"-vf", "bwdif,scale=-2:720", // Deinterlace AND scale down to 720p to prevent browser playback pausing
			"-c:a", "aac",
			"-b:a", "256k",
			"-movflags", "+faststart",
			mp4OutputFile,
		}
		
		cmd := exec.Command("ffmpeg", cmdArgs...)
		out, err := cmd.CombinedOutput()
		
		if err == nil {
			log.Printf("[dvr] HDHomeRun transcode successful for %s", mp4OutputFile)
			// os.Remove(outputFile) // COMMENTED OUT: Preserve the raw .ts file for Android TV / external clients!
			outputFile = mp4OutputFile
		} else {
			log.Printf("[dvr] HDHomeRun transcode failed: %v, out: %s", err, string(out))
		}
	} else if len(tsFiles) > 0 {
		concatPath := filepath.Join(dir, fmt.Sprintf("concat_%d.txt", r.ID))
		defer os.Remove(concatPath)
		var concatContent strings.Builder
		for _, ts := range tsFiles {
			// Because chunks are padded (e.g. _00001.ts), ReadDir's lexicographical sort is correct.
			concatContent.WriteString(fmt.Sprintf("file '%s'\n", ts))
		}
		os.WriteFile(concatPath, []byte(concatContent.String()), 0644)
		
		db.UpdateRecordingStatus(r.ID, "processing", "")
		log.Printf("[dvr] concatenating %d chunks into MP4 to eliminate PTS gaps...", len(tsFiles))
		
		cmd := exec.Command("ffmpeg", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", mp4OutputFile)
		out, err := cmd.CombinedOutput()
		
		if err == nil {
			log.Printf("[dvr] instant concat successful for %s", mp4OutputFile)
			
			// COMMENTED OUT: Preserve the raw HLS chunks and .m3u8 playlist for Android TV!
			// for _, f := range files {
			// 	if strings.HasPrefix(f.Name(), base) && !strings.HasSuffix(f.Name(), ".mp4") {
			// 		os.Remove(filepath.Join(dir, f.Name()))
			// 	}
			// }
			
			outputFile = mp4OutputFile
		} else {
			log.Printf("[dvr] concat failed: %v, out: %s", err, string(out))
			// If it fails, we safely fall back to serving the .m3u8 playlist natively
		}
	}

	db.UpdateRecordingStatus(r.ID, "completed", outputFile)
}
