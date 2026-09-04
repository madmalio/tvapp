code = '''package main
import (
	"fmt"
	"regexp"
)
func main() {
	epgUrlRe := regexp.MustCompile((?:url-tvg|x-tvg-url)="?([^"\s]+)"?)
	line := #EXTM3U x-tvg-url="http://example.com/epg.xml"
	m := epgUrlRe.FindStringSubmatch(line)
	fmt.Printf("%q\\n", m)
}'''

with open('test_regex.go', 'w') as f:
    f.write(code)
