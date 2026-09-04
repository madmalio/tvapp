package main
import (
	"fmt"
	"tvapp/internal/iptv"
)
func main() {
	url := "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/refs/heads/main/playlists/plex_us.m3u"
	channels, epgUrl, _ := iptv.ParseM3U(url)
	fmt.Printf("EPG URL: %s\n", epgUrl)
	fmt.Printf("First channel Name: %s, TvgID: %s\n", channels[0].Name, channels[0].TvgID)
}
