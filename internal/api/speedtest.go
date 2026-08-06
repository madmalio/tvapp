package api

import (
	"crypto/rand"
	"net/http"
)

// speedtestHandler generates a 5MB payload of random data to prevent browser compression/caching
func speedtestHandler(w http.ResponseWriter, r *http.Request) {
	// 5MB payload
	const payloadSize = 5 * 1024 * 1024
	payload := make([]byte, payloadSize)
	rand.Read(payload)

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	w.WriteHeader(http.StatusOK)
	
	w.Write(payload)
}
