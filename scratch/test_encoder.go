package main
import (
	"fmt"
	"tvapp/internal/stream"
)
func main() {
	fmt.Println(stream.GetOptimalVideoArgs("source"))
	fmt.Println(stream.GetOptimalVideoArgs("1080p_high"))
}
