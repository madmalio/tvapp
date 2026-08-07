//go:build windows

package stream

import "os"

func PauseProcess(p *os.Process) error {
	// Process pausing not supported natively on Windows
	return nil
}

func ResumeProcess(p *os.Process) error {
	return nil
}
