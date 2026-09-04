package stream

import (
	"context"
	"log"
	"net/url"
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
	tunerType = strings.ToLower(tunerType)
	dir := filepath.Dir(outputFile)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	streamURL := rawURL
	if tunerType != "hdhomerun" && tunerType != "rtsp" {
		// Route through the local proxy to piggyback on active sessions and bypass the PlutoTV slate
		streamURL = "http://127.0.0.1:8080/api/proxy?adskip=1&url=" + url.QueryEscape(rawURL)
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
		// Treat HDHomeRun / MediaMTX HLS streams as a dumb pipe (copy) to preserve quality without transcoding
		args = []string{
			"-user_agent", userAgent,
		}
		if headers != "" {
			args = append(args, "-headers", headers)
		}
		args = append(args,
			"-i", streamURL,
			"-t", strconv.Itoa(durationSec),
			"-c", "copy",
			"-copyts",
			"-f", "mpegts",
			outputFile,
		)
	} else {
		// Just act as a dumb pipe: append all HLS segments into a single .ts file and preserve the broken timestamps.
		// The scheduler will fix the timestamps when it converts the .ts file to .mp4.
		args = []string{
			"-user_agent", userAgent,
			"-headers", headers,
			"-live_start_index", "-1", // Skip the slate by starting at the live edge
			"-err_detect", "ignore_err", // Ignore ad-break errors
			"-i", streamURL,
			"-t", strconv.Itoa(durationSec),
			"-c", "copy",
			"-copyts", // Keep timestamps exactly as they are to prevent demuxer stalling
			"-f", "mpegts",
			outputFile,
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(durationSec+5)*time.Second)
	defer cancel()

	if tunerType != "hdhomerun" && tunerType != "rtsp" {
		// Resilient loop for IPTV: append to the .ts file and restart ffmpeg if it crashes on ad breaks
		f, err := os.OpenFile(outputFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return err
		}
		defer f.Close()

		startTime := time.Now()
		for {
			elapsed := time.Since(startTime)
			remaining := durationSec - int(elapsed.Seconds())
			if remaining <= 0 || ctx.Err() != nil {
				break
			}

			args = []string{
				"-user_agent", userAgent,
				"-headers", headers,
				"-live_start_index", "-1",
				"-err_detect", "ignore_err",
				"-i", streamURL,
				"-t", strconv.Itoa(remaining),
				"-c", "copy",
				"-copyts",
				"-f", "mpegts",
				"pipe:1",
			}

			cmd := exec.CommandContext(ctx, "ffmpeg", args...)
			cmd.Stdout = f

			recordingsMutex.Lock()
			activeRecordings[recordingID] = cmd
			recordingsMutex.Unlock()

			log.Printf("[dvr] starting/resuming iptv chunk for %ds", remaining)
			err := cmd.Run()

			if ctx.Err() != nil || (err != nil && (strings.Contains(err.Error(), "killed") || strings.Contains(err.Error(), "exit status 255"))) {
				log.Printf("[dvr] recording %d stopped manually or timed out", recordingID)
				break
			}
			
			if err != nil {
				log.Printf("[dvr] ffmpeg exited on ad break (%v), reconnecting in 2s...", err)
				time.Sleep(2 * time.Second)
			}
		}
		log.Printf("[dvr] finished recording to %s", outputFile)
		return nil
	}

	// Standard execution for HDHomeRun and RTSP (M3U8 output)
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
