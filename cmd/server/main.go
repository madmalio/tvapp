package main

import (
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"tvapp/cmd/server/webdist"
	"tvapp/internal/api"
	"tvapp/internal/db"
)

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

	go func() {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
		<-quit
		log.Println("shutting down...")
		srv.Close()
	}()

	log.Printf("tvapp listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("serve: %v", err)
	}
}
