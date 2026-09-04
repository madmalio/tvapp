package main
import (
	"fmt"
	"tvapp/internal/epg"
)
func main() {
	url := "https://github.com/matthuisman/i.mjh.nz/raw/master/Plex/us.xml.gz"
	entries, _ := epg.ParseXMLTV(url)
	for i := 0; i < 5; i++ {
		fmt.Printf("ChannelID: %s, Names: %v\n", entries[i].ChannelID, entries[i].ChannelNames)
	}
}
