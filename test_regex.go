package main
import (
	"fmt"
	"regexp"
)
func main() {
	epgUrlRe := regexp.MustCompile(`(?:url-tvg|x-tvg-url)="?([^"\s]+)"?`)
	line := `#EXTM3U x-tvg-url="http://example.com/epg.xml"`
	m := epgUrlRe.FindStringSubmatch(line)
	fmt.Printf("%q", m)
}
