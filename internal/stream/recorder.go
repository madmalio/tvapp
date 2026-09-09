package stream

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/binary"
	"encoding/hex"
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
	recordingCancels = make(map[int]context.CancelFunc)
	recordingsMutex  sync.Mutex
)

func StopRecording(recordingID int) {
	recordingsMutex.Lock()
	cmd, okCmd := activeRecordings[recordingID]
	cancel, okCancel := recordingCancels[recordingID]
	recordingsMutex.Unlock()

	if okCancel && cancel != nil {
		log.Printf("[dvr] manually cancelling context for recording %d", recordingID)
		cancel()
	}

	if okCmd && cmd != nil && cmd.Process != nil {
		log.Printf("[dvr] manually killing process for recording %d", recordingID)
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
		// Record Raw, Transcode Later. 
		// Dump the MPEG-2 stream directly to a TS file without transcoding live.
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
			"-f", "mpegts",
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

	recordingsMutex.Lock()
	recordingCancels[recordingID] = cancel
	recordingsMutex.Unlock()

	defer func() {
		recordingsMutex.Lock()
		delete(recordingCancels, recordingID)
		recordingsMutex.Unlock()
	}()

	if tunerType != "hdhomerun" && tunerType != "rtsp" {
		// Custom Go HLS downloader for IPTV.
		// Bypasses all FFmpeg crash/gap issues by parsing the playlist ourselves,
		// perfectly tracking media sequences, and skipping ad_gap.ts natively.
		hlsBase := strings.TrimSuffix(outputFile, filepath.Ext(outputFile))
		
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
		needsDiscontinuity := false

		// Initialize the native m3u8 playlist file
		os.WriteFile(outputFile, []byte("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:15\n#EXT-X-PLAYLIST-TYPE:VOD\n"), 0644)

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

			var currentKey []byte
			var currentIV []byte
			var keyMethod string = "NONE"

			// Parse chunks
			for i := 0; i < len(lines); i++ {
				line := strings.TrimSpace(lines[i])

				if strings.HasPrefix(line, "#EXT-X-KEY:") {
					if strings.Contains(line, "METHOD=NONE") {
						keyMethod = "NONE"
					} else if strings.Contains(line, "METHOD=AES-128") {
						keyMethod = "AES-128"
						uriStart := strings.Index(line, `URI="`) + 5
						uriEnd := strings.Index(line[uriStart:], `"`)
						if uriStart >= 5 && uriEnd >= 0 {
							keyURI := line[uriStart : uriStart+uriEnd]
							if !strings.HasPrefix(keyURI, "http") {
								baseURL, _ := url.Parse(streamURL)
								rel, _ := url.Parse(keyURI)
								keyURI = baseURL.ResolveReference(rel).String()
							}
							kreq, _ := http.NewRequestWithContext(ctx, "GET", keyURI, nil)
							for k, v := range reqHeaders {
								kreq.Header.Set(k, v)
							}
							kresp, _ := client.Do(kreq)
							if kresp != nil && kresp.StatusCode == 200 {
								currentKey, _ = io.ReadAll(kresp.Body)
								kresp.Body.Close()
							}
						}
						ivStart := strings.Index(line, "IV=0x")
						if ivStart >= 0 {
							ivStr := line[ivStart+5:]
							if comma := strings.Index(ivStr, ","); comma >= 0 {
								ivStr = ivStr[:comma]
							}
							currentIV, _ = hex.DecodeString(ivStr)
						} else {
							currentIV = nil
						}
					}
					continue
				}

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
										// Decrypt AES-128
										if keyMethod == "AES-128" && len(currentKey) == 16 && len(chunkData)%16 == 0 {
											iv := currentIV
											if len(iv) != 16 {
												iv = make([]byte, 16)
												binary.BigEndian.PutUint64(iv[8:], uint64(seq))
											}
											block, _ := aes.NewCipher(currentKey)
											mode := cipher.NewCBCDecrypter(block, iv)
											mode.CryptBlocks(chunkData, chunkData)
											
											// PKCS7 unpadding
											padLen := int(chunkData[len(chunkData)-1])
											if padLen > 0 && padLen <= 16 {
												chunkData = chunkData[:len(chunkData)-padLen]
											}
										}

										chunkFile := fmt.Sprintf("%s_%05d.ts", hlsBase, chunkIndex)
										os.WriteFile(chunkFile, chunkData, 0644)
										
										// Append to native M3U8 playlist
										f, _ := os.OpenFile(outputFile, os.O_APPEND|os.O_WRONLY, 0644)
										if needsDiscontinuity {
											f.WriteString("#EXT-X-DISCONTINUITY\n")
											needsDiscontinuity = false
										}
										f.WriteString(fmt.Sprintf("%s\n%s\n", line, filepath.Base(chunkFile)))
										f.Close()

										chunkIndex++
									}
								}
							} else {
								// Ad gap detected! Mark for discontinuity
								if chunkIndex > 0 {
									needsDiscontinuity = true
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
		
		f, err := os.OpenFile(outputFile, os.O_APPEND|os.O_WRONLY, 0644)
		if err == nil {
			f.WriteString("#EXT-X-ENDLIST\n")
			f.Close()
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
			if strings.HasSuffix(outputFile, ".m3u8") {
				f, err := os.OpenFile(outputFile, os.O_APPEND|os.O_WRONLY, 0644)
				if err == nil {
					f.WriteString("\n#EXT-X-ENDLIST\n")
					f.Close()
				}
			}
			return nil
		}
		log.Printf("[dvr] ffmpeg error: %v, out: %s", err, string(out))
		return err
	}

	log.Printf("[dvr] finished recording to %s", outputFile)
	return nil
}
