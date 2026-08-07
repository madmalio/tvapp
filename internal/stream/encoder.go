package stream

import (
	"bytes"
	"log"
	"os/exec"
	"strings"
	"sync"
)

var (
	encoderArgsCache []string
	encoderOnce      sync.Once
)

// GetOptimalVideoArgs detects the best available hardware encoder on the system and returns its FFmpeg arguments.
// quality can be: "source", "1080p_high", "1080p_std", "720p_high", "720p_std", "480p_high", "480p_std", "360p_low"
func GetOptimalVideoArgs(quality string) []string {
	encoderOnce.Do(func() {
		cmd := exec.Command("ffmpeg", "-hide_banner", "-encoders")
		var out bytes.Buffer
		cmd.Stdout = &out
		if err := cmd.Run(); err != nil {
			log.Printf("[stream] failed to check ffmpeg encoders, falling back to libx264: %v", err)
			encoderArgsCache = softwareEncoder()
			return
		}

		output := out.String()

		testEncoder := func(codec string) bool {
			// Run a tiny test encode to verify the GPU and drivers actually exist
			err := exec.Command("ffmpeg", "-v", "quiet", "-f", "lavfi", "-i", "nullsrc=s=128x128", "-vframes", "1", "-c:v", codec, "-f", "null", "-").Run()
			return err == nil
		}

		// Priority 1: Nvidia NVENC
		if strings.Contains(output, " h264_nvenc ") && testEncoder("h264_nvenc") {
			log.Println("[stream] Detected hardware encoder: h264_nvenc (Nvidia)")
			encoderArgsCache = []string{
				"-c:v", "h264_nvenc",
				"-preset", "p4", // p4 is medium/default. p1 causes severe pixelization at capped bitrates.
				"-cq", "26",
				"-vf", "bwdif", // Hardware-friendly fast deinterlacer
				"-g", "30", // Force keyframes every 1 second
			}
			return
		}

		// Priority 2: Intel QuickSync
		// DISABLED to force software encoding with strict bitrate caps
		/*
		testQSV := func() bool {
			// Test QSV with explicit device initialization on Linux
			err := exec.Command("ffmpeg", "-v", "quiet", "-init_hw_device", "qsv=hw:/dev/dri/renderD128", "-f", "lavfi", "-i", "nullsrc=s=128x128", "-vframes", "1", "-c:v", "h264_qsv", "-f", "null", "-").Run()
			if err == nil { return true }
			// Test QSV without explicit init (Windows/Mac)
			return testEncoder("h264_qsv")
		}

		if strings.Contains(output, " h264_qsv ") && testQSV() {
			log.Println("[stream] Detected hardware encoder: h264_qsv (Intel QuickSync)")
			encoderArgsCache = []string{
				"-init_hw_device", "qsv=hw:/dev/dri/renderD128", // QSV requires device init on Linux
				"-filter_hw_device", "hw",
				"-c:v", "h264_qsv",
				"-preset", "veryfast",
				"-global_quality", "25",
				"-vf", "hwupload=extra_hw_frames=64,format=qsv,vpp_qsv=deinterlace=2", // Hardware deinterlacing
				"-g", "30",
			}
			return
		}
		*/

		// Priority 3: Mac VideoToolbox
		if strings.Contains(output, " h264_videotoolbox ") && testEncoder("h264_videotoolbox") {
			log.Println("[stream] Detected hardware encoder: h264_videotoolbox (Mac OS)")
			encoderArgsCache = []string{
				"-c:v", "h264_videotoolbox",
				"-q:v", "50",
				"-vf", "bwdif",
				"-g", "30",
			}
			return
		}

		// Priority 4: AMD AMF
		if strings.Contains(output, " h264_amf ") && testEncoder("h264_amf") {
			log.Println("[stream] Detected hardware encoder: h264_amf (AMD)")
			encoderArgsCache = []string{
				"-c:v", "h264_amf",
				"-quality", "balanced", // speed causes massive pixelization
				"-qp_i", "23", "-qp_p", "23",
				"-vf", "bwdif",
				"-g", "30",
			}
			return
		}

		// Priority 5: Linux VAAPI
		// DISABLED to force software encoding
		/*
		if strings.Contains(output, " h264_vaapi ") {
			// Test VAAPI with the device flag
			err := exec.Command("ffmpeg", "-v", "quiet", "-vaapi_device", "/dev/dri/renderD128", "-f", "lavfi", "-i", "nullsrc=s=128x128", "-vframes", "1", "-vf", "format=nv12,hwupload", "-c:v", "h264_vaapi", "-f", "null", "-").Run()
			if err == nil {
				log.Println("[stream] Detected hardware encoder: h264_vaapi (Linux VAAPI)")
				encoderArgsCache = []string{
					"-vaapi_device", "/dev/dri/renderD128", // Required on Linux for VAAPI initialization
					"-c:v", "h264_vaapi",
					"-qp", "23",
					"-vf", "bwdif,format=nv12,hwupload",
					"-g", "30",
				}
				return
			}
		}
		*/

		// Fallback: Software encoding
		log.Println("[stream] No hardware encoders detected, falling back to libx264")
		encoderArgsCache = softwareEncoder()
	})

	// Now that we have the base encoder args, apply the quality constraints
	args := append([]string{}, encoderArgsCache...)
	
	switch quality {
	case "source":
		// No bitrate cap, native resolution
		// Just ensure bwdif is present
	case "1080p_high":
		args = append(args, "-maxrate", "8M", "-bufsize", "16M")
	case "1080p_std":
		args = append(args, "-maxrate", "5M", "-bufsize", "10M")
	case "720p_high":
		args = append(args, "-maxrate", "4M", "-bufsize", "8M", "-vf", "bwdif,scale=-1:720")
	case "720p_std":
		args = append(args, "-maxrate", "2M", "-bufsize", "4M", "-vf", "bwdif,scale=-1:720")
	case "480p_high":
		args = append(args, "-maxrate", "1.5M", "-bufsize", "3M", "-vf", "bwdif,scale=-1:480")
	case "480p_std":
		args = append(args, "-maxrate", "1M", "-bufsize", "2M", "-vf", "bwdif,scale=-1:480")
	case "360p_low":
		args = append(args, "-maxrate", "800k", "-bufsize", "1.5M", "-vf", "bwdif,scale=-1:360")
	default:
		// Default to source
	}

	// Extract original hardware-specific flags (like VAAPI's hwupload)
	isVaapi := false
	for _, arg := range args {
		if arg == "h264_vaapi" {
			isVaapi = true
			break
		}
	}

	var finalArgs []string
	for i := 0; i < len(args); i++ {
		if args[i] == "-vf" || args[i] == "-maxrate" || args[i] == "-bufsize" || args[i] == "-b:v" {
			i++ // skip the value too
			continue
		}
		if quality != "source" {
			// Strip Constant Quality flags! If we set a strict low bitrate (e.g. 1 Mbps) but leave 
			// the Constant Quality flag (like -cq 26), the encoder fights itself. It tries to hit 
			// perfect quality, hits the 1 Mbps wall, drops frames, and causes endless player buffering.
			if args[i] == "-cq" || args[i] == "-global_quality" || args[i] == "-q:v" || args[i] == "-quality" || args[i] == "-crf" || args[i] == "-qp" || args[i] == "-qp_i" || args[i] == "-qp_p" {
				i++ // skip the value
				continue
			}
		}
		finalArgs = append(finalArgs, args[i])
	}

	// Helper to build the final filter
	buildVf := func(scale string) string {
		vf := "bwdif"
		if scale != "" {
			vf += ",scale=" + scale
		}
		if isVaapi {
			vf += ",format=nv12,hwupload"
		}
		return vf
	}

	if quality == "source" {
		finalArgs = append(finalArgs, "-vf", buildVf(""))
	} else if isVaapi {
		// VAAPI on this Intel driver ONLY supports CQP mode. We cannot pass -b:v or -maxrate.
		// We control the bitrate purely through the -qp parameter (higher QP = lower quality/bitrate).
		qp := "23"
		scale := ""
		if quality == "1080p_high" { qp = "23" }
		if quality == "1080p_std" { qp = "26" }
		if quality == "720p_high" { qp = "26"; scale = "-1:720" }
		if quality == "720p_std" { qp = "29"; scale = "-1:720" }
		if quality == "480p_high" { qp = "32"; scale = "-1:480" }
		finalArgs = append(finalArgs, "-qp", qp, "-vf", buildVf(scale))
	} else {
		// Software encoder supports perfect CBR. We add -b:v to force CBR instead of defaulting to a starved CRF.
		// For standard and low profiles, we also drop the framerate to 30fps (-r 30) to double the bits per frame.
		if quality == "1080p_high" {
			finalArgs = append(finalArgs, "-b:v", "8M", "-maxrate", "8M", "-bufsize", "16M", "-vf", buildVf(""))
		} else if quality == "1080p_std" {
			finalArgs = append(finalArgs, "-b:v", "5M", "-maxrate", "5M", "-bufsize", "10M", "-r", "30", "-vf", buildVf(""))
		} else if quality == "720p_high" {
			finalArgs = append(finalArgs, "-b:v", "4M", "-maxrate", "4M", "-bufsize", "8M", "-vf", buildVf("-1:720"))
		} else if quality == "720p_std" {
			finalArgs = append(finalArgs, "-b:v", "2M", "-maxrate", "2M", "-bufsize", "4M", "-r", "30", "-vf", buildVf("-1:720"))
		} else if quality == "480p_high" {
			finalArgs = append(finalArgs, "-b:v", "1.5M", "-maxrate", "1.5M", "-bufsize", "3M", "-r", "30", "-vf", buildVf("-1:480"))
		} else if quality == "480p_std" {
			finalArgs = append(finalArgs, "-b:v", "1M", "-maxrate", "1M", "-bufsize", "2M", "-r", "30", "-vf", buildVf("-1:480"))
		} else if quality == "360p_low" {
			finalArgs = append(finalArgs, "-b:v", "800k", "-maxrate", "800k", "-bufsize", "1.5M", "-r", "30", "-vf", buildVf("-1:360"))
		} else {
			finalArgs = append(finalArgs, "-vf", buildVf(""))
		}
	}

	return finalArgs
}

func softwareEncoder() []string {
	return []string{
		"-c:v", "libx264",
		"-preset", "veryfast",
		"-crf", "23",
		"-vf", "bwdif",
		"-g", "30",
	}
}
