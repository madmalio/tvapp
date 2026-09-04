package main
import (
	"fmt"
	"regexp"
)
func main() {
	epgUrlRe := regexp.MustCompile((?:url-tvg|x-tvg-url)="?([^"\s]+)"?)
	line := #EXTM3U url-tvg="https://github.com/matthuisman/i.mjh.nz/raw/master/Plex/us.xml.gz"
	m := epgUrlRe.FindStringSubmatch(line)
	fmt.Printf("%q", m)
}
