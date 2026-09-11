package stream

import (
	"context"
	"io"
	"log"
	"net/http"
	"sync"
)

var (
	poolMutex    sync.Mutex
	broadcasters = make(map[string]*Broadcaster)
)

type Broadcaster struct {
	url         string
	subscribers map[chan []byte]bool
	mu          sync.Mutex
	cancel      context.CancelFunc
}

func SubscribeTuner(url string) (chan []byte, func(), error) {
	poolMutex.Lock()
	defer poolMutex.Unlock()

	b, exists := broadcasters[url]
	if !exists {
		ctx, cancel := context.WithCancel(context.Background())
		b = &Broadcaster{
			url:         url,
			subscribers: make(map[chan []byte]bool),
			cancel:      cancel,
		}
		broadcasters[url] = b
		go b.run(ctx)
	}

	// 100 buffers of 32KB is ~3MB buffer per client. Helps with bursty writes.
	sub := make(chan []byte, 100)
	b.mu.Lock()
	b.subscribers[sub] = true
	b.mu.Unlock()

	unsubscribe := func() {
		b.mu.Lock()
		if _, active := b.subscribers[sub]; active {
			delete(b.subscribers, sub)
			close(sub)
		}
		count := len(b.subscribers)
		b.mu.Unlock()

		if count == 0 {
			poolMutex.Lock()
			// Double check inside global lock
			b.mu.Lock()
			finalCount := len(b.subscribers)
			b.mu.Unlock()
			
			if finalCount == 0 {
				log.Printf("[tunerpool] no more subscribers for %s, closing tuner", b.url)
				b.cancel()
				delete(broadcasters, b.url)
			}
			poolMutex.Unlock()
		}
	}

	return sub, unsubscribe, nil
}

func (b *Broadcaster) run(ctx context.Context) {
	log.Printf("[tunerpool] starting tuner stream for %s", b.url)
	
	req, err := http.NewRequestWithContext(ctx, "GET", b.url, nil)
	if err != nil {
		log.Printf("[tunerpool] request error: %v", err)
		return
	}

	client := &http.Client{Timeout: 0} // infinite timeout for streaming
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() == nil {
			log.Printf("[tunerpool] stream error: %v", err)
		}
		return
	}
	defer resp.Body.Close()

	buf := make([]byte, 32*1024) // 32KB chunks
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			// Copy chunk so we can reuse the buffer safely across threads
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			
			b.mu.Lock()
			for sub := range b.subscribers {
				select {
				case sub <- chunk:
					// Sent successfully
				default:
					// Subscriber is blocking too much, drop chunk to prevent stalling the tuner
				}
			}
			b.mu.Unlock()
		}
		if err != nil {
			if err != io.EOF && ctx.Err() == nil {
				log.Printf("[tunerpool] stream read error: %v", err)
			}
			break
		}
	}
	log.Printf("[tunerpool] stopped tuner stream for %s", b.url)
}
