package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"time"
)

// LogHook is a simple log formatter that reads from stdin
// and formats logs as: [HH:MM:SS.mmm] [service-name] <actual logs>
// 
// This is used by the email service to cleanly format its logs
// when being managed by the bootstrap_manager
type LogHook struct {
	ServiceName string
}

// FormatLog formats a log line with timestamp and service name
func (lh *LogHook) FormatLog(line string) string {
	if line == "" {
		return ""
	}
	timestamp := time.Now().Format("15:04:05.000")
	return fmt.Sprintf("[%s] [%s] %s", timestamp, lh.ServiceName, line)
}

// ProcessStream reads from a scanner and writes formatted logs to output
func (lh *LogHook) ProcessStream(scanner *bufio.Scanner, output *os.File) {
	for scanner.Scan() {
		line := scanner.Text()
		formatted := lh.FormatLog(line)
		if formatted != "" {
			fmt.Fprintln(output, formatted)
		}
	}

	if err := scanner.Err(); err != nil {
		fmt.Fprintf(output, "[%s] [%s] ERROR: %v\n",
			time.Now().Format("15:04:05.000"), lh.ServiceName, err)
	}
}

func main() {
	// Get service name from environment or command line
	serviceName := os.Getenv("SERVICE_NAME")
	if serviceName == "" && len(os.Args) > 1 {
		serviceName = os.Args[1]
	}
	if serviceName == "" {
		serviceName = "unknown-service"
	}

	hook := &LogHook{ServiceName: serviceName}

	// Start processing stdin
	// This reads from the service's stdout and formats it
	fmt.Fprintf(os.Stderr, "[%s] [%s] Log hook initialized\n",
		time.Now().Format("15:04:05.000"), hook.ServiceName)

	scanner := bufio.NewScanner(os.Stdin)
	hook.ProcessStream(scanner, os.Stdout)
}
