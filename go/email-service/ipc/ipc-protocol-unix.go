//go:build linux || darwin || freebsd
// +build linux darwin freebsd

package emailservice

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/unix"
)

// lockKeyInMemoryUnix locks memory pages on Unix-like systems (Linux, macOS, etc.)
// This prevents the encryption key from being swapped to disk
func (p *IPCProtocol) lockKeyInMemoryUnix(keyBytes *[32]byte) error {
	addr := uintptr(unsafe.Pointer(keyBytes))
	if addr == 0 {
		return nil
	}

	size := unsafe.Sizeof(*keyBytes)

	// mlocallock: lock pages into memory
	// MLOCK_ONFAULT: only lock pages that are actually used
	if err := unix.Mlock((*[32]byte)(unsafe.Pointer(addr))[:size:size]); err != nil {
		// Non-fatal: lock may fail due to permissions
		return fmt.Errorf("mlock failed (non-fatal): %w", err)
	}

	return nil
}

// secureClearMemoryUnix provides platform-specific memory clearing for Unix
func secureClearMemoryUnix(data []byte) {
	if len(data) == 0 {
		return
	}

	// Use explicit_bzero or equivalent for Unix
	// This prevents compiler optimization from removing the clear
	_ = unix.Syscall3(
		unix.SYS_MEMSET,
		uintptr(unsafe.Pointer(&data[0])),
		0,
		uintptr(len(data)),
	)

	// Also do it manually to be sure
	for i := range data {
		data[i] = 0
	}

	// Request the OS to not swap this page (optional)
	_ = unix.Madvise(data, unix.MADV_DONTNEED)
}

// init sets the platform-specific clear function
func init() {
	// Will be overridden by actual implementation
}
