//go:build !windows

package api

import "golang.org/x/sys/unix"

// getDiskSpace returns total and free space in bytes
func getDiskSpace(path string) (uint64, uint64, error) {
	var stat unix.Statfs_t
	err := unix.Statfs(path, &stat)
	if err != nil {
		return 0, 0, err
	}
	
	// Frsize is the fundamental block size, fallback to Bsize if 0
	bsize := uint64(stat.Frsize)
	if bsize == 0 {
		bsize = uint64(stat.Bsize)
	}
	
	total := uint64(stat.Blocks) * bsize
	free := uint64(stat.Bavail) * bsize
	return total, free, nil
}
