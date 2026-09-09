package stream

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
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
		args = []string{
			"-user_agent", userAgent,
		}
		if headers != "" {
			args = append(args, "-headers", headers)
		}
		args = append(args,
			"-i", streamURL,
			"-t", strconv.Itoa(durationSec),
		)
		args = append(args, GetOptimalVideoArgs("1080p_high")...)
		args = append(args,
			"-c:a", "aac",
			"-b:a", "256k",
			"-f", "hls",
			"-hls_time", "6",
			"-hls_list_size", "0",
			"-hls_segment_filename", segmentFile,
			outputFile,
		)
	} else {
		// IPTV (e.g. Pluto, Stirr, Samsung)
		// We use -c copy to dump the stream to disk without transcoding.
		// We use -f hls to let the web player handle PTS gaps natively via hls.js!
		args = []string{
			"-user_agent", userAgent,
			"-headers", headers,
			"-live_start_index", "-1", // Skip the slate by starting at the live edge
			"-err_detect", "ignore_err", // Ignore ad-break errors
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

	if tunerType != "hdhomerun" && tunerType != "rtsp" {
		// Custom Go HLS downloader for IPTV.
		// Bypasses all FFmpeg crash/gap issues by parsing the playlist ourselves,
		// perfectly tracking media sequences, and skipping ad_gap.ts natively.
		hlsBase := strings.TrimSuffix(outputFile, filepath.Ext(outputFile))
		
		// Register a dummy command so the stop button works (we just kill context)
		recordingsMutex.Lock()
		activeRecordings[recordingID] = exec.CommandContext(ctx, "sleep", "infinity")
		recordingsMutex.Unlock()

		defer func() {
			recordingsMutex.Lock()
			delete(activeRecordings, recordingID)
			recordingsMutex.Unlock()
		}()

		client := &http.Client{Timeout: 10 * time.Second}
		reqHeaders := make(map[string]string)
		if headers != "" {
			for _, h := range strings.Split(headers, "\r\n") {
				parts := strings.SplitN(h, ": ", 2)
				if len(parts) == 2 {
					reqHeaders[parts[0]] = parts[1]
				}
			}
		}
		if reqHeaders["User-Agent"] == "" {
			reqHeaders["User-Agent"] = userAgent
		}

		endTime := time.Now().Add(time.Duration(durationSec) * time.Second)
		lastSeq := -1
		chunkIndex := 0

		log.Printf("[dvr] starting native go iptv downloader for %ds", durationSec)

		for time.Now().Before(endTime) && ctx.Err() == nil {
			req, err := http.NewRequestWithContext(ctx, "GET", streamURL, nil)
			if err != nil {
				return err
			}
			for k, v := range reqHeaders {
				req.Header.Set(k, v)
			}
			
			resp, err := client.Do(req)
			if err != nil {
				time.Sleep(2 * time.Second)
				continue
			}
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()

			lines := strings.Split(string(body), "\n")
			seq := 0
			for _, line := range lines {
				if strings.HasPrefix(line, "#EXT-X-MEDIA-SEQUENCE:") {
					fmt.Sscanf(line, "#EXT-X-MEDIA-SEQUENCE:%d", &seq)
					break
				}
			}

			// Parse chunks
			for i := 0; i < len(lines); i++ {
				line := strings.TrimSpace(lines[i])
				if strings.HasPrefix(line, "#EXTINF:") {
					var uri string
					for j := i + 1; j < len(lines); j++ {
						l := strings.TrimSpace(lines[j])
						if l != "" && !strings.HasPrefix(l, "#") {
							uri = l
							break
						}
					}
					
					if uri != "" {
						if seq > lastSeq {
							if uri != "ad_gap.ts" && !strings.Contains(uri, "ad_gap") {
								chunkURL := uri
								if !strings.HasPrefix(chunkURL, "http") {
									baseURL, _ := url.Parse(streamURL)
									rel, _ := url.Parse(chunkURL)
									chunkURL = baseURL.ResolveReference(rel).String()
								}
								
								creq, _ := http.NewRequestWithContext(ctx, "GET", chunkURL, nil)
								for k, v := range reqHeaders {
									creq.Header.Set(k, v)
								}
								cresp, cerr := client.Do(creq)
								if cerr == nil && cresp.StatusCode == 200 {
									chunkData, _ := io.ReadAll(cresp.Body)
									cresp.Body.Close()
									if len(chunkData) > 1024 {
										chunkFile := fmt.Sprintf("%s_%05d.ts", hlsBase, chunkIndex)
										os.WriteFile(chunkFile, chunkData, 0644)
										chunkIndex++
									}
								}
							}
							lastSeq = seq
						}
						seq++
					}
				}
			}
			time.Sleep(4 * time.Second)
		}
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
