package stream

import (
	"log"
	"os"
	"os/exec"
)

// TranscodeToMP4 takes a raw .ts recording and compresses it to a 1080p-capped MP4 file.
// It uses hardware encoding if available.
func TranscodeToMP4(inputFile string, outputFile string) error {
	log.Printf("[dvr] Starting post-processing transcode: %s -> %s", inputFile, outputFile)

	// Get optimal hardware encoder arguments
	// We'll ask for 1080p_high limits (8M/16M), but our custom scale filter will cap resolution without upscaling.
	videoArgs := GetOptimalVideoArgs("1080p_high")

	// We need to inject our smart scale filter. 
	// We'll iterate through videoArgs. If we find "-vf", we append our scale logic.
	// If no "-vf" exists, we add one.
	hasVF := false
	for i, arg := range videoArgs {
		if arg == "-vf" && i+1 < len(videoArgs) {
			videoArgs[i+1] = videoArgs[i+1] + ",scale='min(1920,iw)':-2"
			hasVF = true
			break
		}
	}
	if !hasVF {
		videoArgs = append(videoArgs, "-vf", "scale='min(1920,iw)':-2")
	}

	args := []string{
		"-y", // Overwrite output file if it exists
		"-i", inputFile,
	}
	args = append(args, videoArgs...)
	args = append(args,
		"-c:a", "aac",
		"-b:a", "192k",
		"-movflags", "+faststart", // Optimize MP4 for web streaming
		outputFile,
	)

	cmd := exec.Command("ffmpeg", args...)

	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[dvr] Transcode failed: %v, output: %s", err, string(out))
		// Clean up the partial/failed output file
		os.Remove(outputFile)
		return err
	}

	log.Printf("[dvr] Transcode successful: %s", outputFile)
	return nil
}
