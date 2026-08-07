//go:build linux || darwin

package stream

import (
	"os"
	"syscall"
)

func PauseProcess(p *os.Process) error {
	return p.Signal(syscall.SIGSTOP)
}

func ResumeProcess(p *os.Process) error {
	return p.Signal(syscall.SIGCONT)
}
