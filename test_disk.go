package main

import (
	"fmt"
	"os"
	"path/filepath"
	"golang.org/x/sys/windows"
)

func main() {
	var freeBytesAvailable, totalNumberOfBytes, totalNumberOfFreeBytes uint64
	dvrPath := "recordings"
	os.MkdirAll(dvrPath, 0755)
	
	absPath, _ := filepath.Abs(dvrPath)
	pathPtr, _ := windows.UTF16PtrFromString(absPath)
	
	err := windows.GetDiskFreeSpaceEx(pathPtr, &freeBytesAvailable, &totalNumberOfBytes, &totalNumberOfFreeBytes)
	if err != nil {
		fmt.Println("Error:", err)
		return
	}
	fmt.Printf("Total: %d, Free: %d\n", totalNumberOfBytes/1024/1024/1024, freeBytesAvailable/1024/1024/1024)
}
