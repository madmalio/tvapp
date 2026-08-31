package stream

import (
	"context"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	activeRecordings = make(map[int]*exec.Cmd)
	recordingsMutex  sync.Mutex
)

func StopRecording(recordingID int) {
	recordingsMutex.Lock()
	cmd, ok := activeRecordings[recordingID]
	recordingsMutex.Unlock()
	if ok && cmd != nil && cmd.Process != nil {
		log.Printf("[dvr] manually stopping recording %d", recordingID)
		cmd.Process.Kill()
	}
}

func RecordStream(recordingID int, rawURL string, tunerType string, durationSec int, outputFile string) error {
	dir := filepath.Dir(outputFile)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	streamURL := rawURL
	if tunerType != "hdhomerun" && tunerType != "rtsp" {
		prefetchCookies(rawURL)
		streamURL = resolveStreamURL(rawURL)
	}

	headers := ffmpegHeaders(streamURL)

	var args []string
	
	hlsBase := strings.TrimSuffix(outputFile, filepath.Ext(outputFile))
	segmentFile := hlsBase + "_%05d.ts"

	if tunerType == "rtsp" {
		args = []string{
			"-rtsp_transport", "tcp",
			"-i", streamURL,
			"-t", strconv.Itoa(durationSec),
			"-c", "copy",
			"-f", "hls",
			"-hls_time", "6",
			"-hls_list_size", "0",
			"-hls_segment_filename", segmentFile,
			outputFile,
		}
	} else if tunerType == "hdhomerun" {
		args = []string{
			"-user_agent", userAgent,
			"-headers", headers,
			"-i", streamURL,
			"-t", strconv.Itoa(durationSec),
		}
		args = append(args, GetOptimalVideoArgs("1080p_high")...)
		args = append(args,
			"-c:a", "aac",
			"-b:a", "128k",
			"-f", "hls",
			"-hls_time", "6",
			"-hls_list_size", "0",
			"-hls_segment_filename", segmentFile,
			outputFile,
		)
	} else {
		args = []string{
			"-user_agent", userAgent,
			"-headers", headers,
			"-i", streamURL,
			"-t", strconv.Itoa(durationSec),
			"-c", "copy",
			"-f", "hls",
			"-hls_time", "6",
			"-hls_list_size", "0",
			"-hls_segment_filename", segmentFile,
			outputFile,
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(durationSec+5)*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	
	recordingsMutex.Lock()
	activeRecordings[recordingID] = cmd
	recordingsMutex.Unlock()

	defer func() {
		recordingsMutex.Lock()
		delete(activeRecordings, recordingID)
		recordingsMutex.Unlock()
	}()
	
	log.Printf("[dvr] starting recording: %s for %ds to %s", rawURL, durationSec, outputFile)
	
	out, err := cmd.CombinedOutput()
	if err != nil {
		if strings.Contains(err.Error(), "killed") || strings.Contains(err.Error(), "terminated") || strings.Contains(err.Error(), "interrupt") || strings.Contains(err.Error(), "exit status 255") {
			log.Printf("[dvr] recording %d stopped manually", recordingID)
			
			// Because we hard-killed FFmpeg, we must manually append the End of Stream tag
			// to the playlist so the player knows it's a finished VOD and not a Live stream.
			f, err := os.OpenFile(outputFile, os.O_APPEND|os.O_WRONLY, 0644)
			if err == nil {
				f.WriteString("\n#EXT-X-ENDLIST\n")
				f.Close()
			}
			
			return nil
		}
		log.Printf("[dvr] ffmpeg error: %v, out: %s", err, string(out))
		return err
	}

	log.Printf("[dvr] finished recording to %s", outputFile)
	return nil
}
