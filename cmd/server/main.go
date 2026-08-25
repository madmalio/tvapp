package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"tvapp/cmd/server/webdist"
	"tvapp/internal/api"
	"tvapp/internal/db"
	"tvapp/internal/stream"
)

func startGo2RTC() *exec.Cmd {
	bin := "go2rtc"
	if _, err := os.Stat("./go2rtc"); err == nil {
		bin = "./go2rtc"
	} else if _, err := os.Stat("./go2rtc.exe"); err == nil {
		bin = "./go2rtc.exe"
	} else if _, err := os.Stat("./go2rtc-win.exe"); err == nil {
		bin = "./go2rtc-win.exe"
	} else if _, err := os.Stat("./go2rtc-linux"); err == nil {
		bin = "./go2rtc-linux"
	}

	// Generate go2rtc config with custom ffmpeg templates
	yamlStr := "ffmpeg:\n  aac_stereo: \"-c:a aac -ac 2 -b:a 128k\"\n"
	qualities := []string{"source", "1080p_high", "1080p_std", "720p_high", "720p_std", "480p_high", "480p_std", "360p_low"}
	for _, q := range qualities {
		args := stream.GetOptimalVideoArgs(q)
		yamlStr += fmt.Sprintf("  hdhomerun_%s: \"%s\"\n", q, strings.Join(args, " "))
	}
	os.WriteFile("go2rtc.yaml", []byte(yamlStr), 0644)

	cmd := exec.Command(bin)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		log.Printf("Warning: failed to start go2rtc (%s): %v", bin, err)
		return nil
	}
	log.Printf("Started go2rtc with PID %d", cmd.Process.Pid)
	return cmd
}

func main() {
	if err := db.Init("tvapp.db"); err != nil {
		log.Fatalf("db init: %v", err)
	}
	defer db.Close()

	router := api.NewRouter(webdist.FS)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{Addr: ":" + port, Handler: router}

	mtxCmd := startGo2RTC()

	// Wait a moment for go2rtc to spin up its API listener
	time.Sleep(1 * time.Second)
	api.RegisterAllRTSPCameras()

	api.StartNightlySync()

	go func() {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
		<-quit
		log.Println("shutting down...")
		if mtxCmd != nil && mtxCmd.Process != nil {
			log.Println("stopping go2rtc...")
			mtxCmd.Process.Signal(syscall.SIGTERM)
		}
		srv.Close()
	}()

	log.Printf("tvapp listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("serve: %v", err)
	}
}
