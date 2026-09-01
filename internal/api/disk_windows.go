//go:build windows

package api

import (
	"golang.org/x/sys/windows"
)

// getDiskSpace returns total and free space in bytes
func getDiskSpace(path string) (uint64, uint64, error) {
	var freeBytesAvailable, totalNumberOfBytes, totalNumberOfFreeBytes uint64
	
	// Ensure path is not empty and get a pointer
	pathPtr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, 0, err
	}

	err = windows.GetDiskFreeSpaceEx(pathPtr, &freeBytesAvailable, &totalNumberOfBytes, &totalNumberOfFreeBytes)
	if err != nil {
		return 0, 0, err
	}
	return totalNumberOfBytes, freeBytesAvailable, nil
}
