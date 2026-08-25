package main

import (
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"tvapp/cmd/server/webdist"
	"tvapp/internal/api"
	"tvapp/internal/db"
)

func startMediaMTX() *exec.Cmd {
	bin := "mediamtx"
	if _, err := os.Stat("./mediamtx"); err == nil {
		bin = "./mediamtx"
	} else if _, err := os.Stat("./mediamtx.exe"); err == nil {
		bin = "./mediamtx.exe"
	}

	cmd := exec.Command(bin)
	// Do not bind stdout/stderr to prevent IO blocking that causes stuttering
	if err := cmd.Start(); err != nil {
		log.Printf("Warning: failed to start mediamtx (%s): %v", bin, err)
		return nil
	}
	log.Printf("Started mediamtx with PID %d", cmd.Process.Pid)
	return cmd
}

func startGo2RTC() *exec.Cmd {
	yamlStr := "rtsp:\n  listen: \":8556\"\n"
	yamlStr += "ffmpeg:\n"
	yamlStr += "  bin: ffmpeg\n" // Ensure ffmpeg is used
	os.WriteFile("go2rtc.yaml", []byte(yamlStr), 0644)

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

	cmd := exec.Command(bin)
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

	mtxCmd := startMediaMTX()
	go2Cmd := startGo2RTC()

	// Wait a moment for MediaMTX to spin up its API listener
	time.Sleep(1 * time.Second)
	api.RegisterAllRTSPCameras()

	api.StartNightlySync()

	go func() {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
		<-quit
		log.Println("shutting down...")
		if mtxCmd != nil && mtxCmd.Process != nil {
			log.Println("stopping mediamtx...")
			mtxCmd.Process.Signal(syscall.SIGTERM)
		}
		if go2Cmd != nil && go2Cmd.Process != nil {
			log.Println("stopping go2rtc...")
			go2Cmd.Process.Signal(syscall.SIGTERM)
		}
		srv.Close()
	}()

	log.Printf("tvapp listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("serve: %v", err)
	}
}
