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
