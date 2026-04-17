package main

import (
	"fmt"
	"io/ioutil"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func main() {
	fmt.Println("╔════════════════════════════════════════════════════╗")
	fmt.Println("║    🚀 Email Service - API Wrapper                  ║")
	fmt.Println("╚════════════════════════════════════════════════════╝")

	// Check if SMTP server is running
	fmt.Println("🔍 Checking dependencies...")
	smtpHost := os.Getenv("SMTP_HOST")
	if smtpHost == "" {
		smtpHost = "localhost"
	}
	smtpPort := os.Getenv("SMTP_PORT")
	if smtpPort == "" {
		smtpPort = "3425"
	}

	if !isServiceRunning(smtpHost, smtpPort, 30) {
		fmt.Printf("❌ SMTP Server not running on %s:%s\n", smtpHost, smtpPort)
		fmt.Println("❌ Email Service depends on SMTP Server!")
		fmt.Println("Please start: email-smtp.exe first")
		os.Exit(1)
	}
	fmt.Println("✓ SMTP Server dependency verified")

	// Find the executable directory
	exePath, err := os.Executable()
	if err != nil {
		fmt.Printf("Error: Cannot determine executable path: %v\n", err)
		os.Exit(1)
	}

	exeDir := filepath.Dir(exePath)

	// Look for email-service.js in order of preference:
	// 1. ./dep/email-service.js (preferred - clean builds)
	// 2. ./email-service.js (fallback - local deployment)
	// 3. ../../node/email-sender/build/email-service.js (dev mode)
	jsPath := filepath.Join(exeDir, "dep", "email-service.js")
	if _, err := os.Stat(jsPath); err != nil {
		jsPath = filepath.Join(exeDir, "email-service.js")
		if _, err := os.Stat(jsPath); err != nil {
			jsPath = "../../node/email-sender/build/email-service.js"
			if _, err := os.Stat(jsPath); err != nil {
				fmt.Printf("Error: Cannot find email-service.js\n")
				fmt.Printf("  Checked: %s\n", filepath.Join(exeDir, "dep", "email-service.js"))
				fmt.Printf("  Checked: %s\n", filepath.Join(exeDir, "email-service.js"))
				fmt.Printf("  Checked: %s\n", "../../node/email-sender/build/email-service.js")
				os.Exit(1)
			}
		}
	}

	fmt.Printf("📂 Service: %s\n", jsPath)

	// Find node executable
	nodeExe := "node"
	if exe, err := exec.LookPath("node"); err == nil {
		nodeExe = exe
	}

	fmt.Printf("📦 Node.js: %s\n", nodeExe)

	// Check for TEST_MODE - if set or if 'test' argument is passed
	testMode := os.Getenv("TEST_MODE") == "1" || os.Getenv("TEST_MODE") == "true"

	// Also check for 'test' command-line argument
	for _, arg := range os.Args[1:] {
		if arg == "test" || arg == "debug" {
			testMode = true
			break
		}
	}

	if testMode {
		fmt.Println("\n🧪 TEST MODE ENABLED - Running in standalone mode without Bootstrap Manager")
	}

	// Set up environment variables
	env := os.Environ()

	// Set NODE_PATH for module resolution
	nodeModulesPath := filepath.Join(exeDir, "dep", "node_modules")
	env = append(env, "NODE_PATH="+nodeModulesPath)

	// Set CONFIG_PATH for configuration files
	configPath := filepath.Join(exeDir, "config")
	env = append(env, "CONFIG_PATH="+configPath)

	// Pass TEST_MODE to Node.js
	if testMode {
		env = append(env, "TEST_MODE=1")
	}

	// REQUEST LOGGER FROM BOOTSTRAP (unless in TEST_MODE)
	threadID := "unknown"
	loggerCode := ""

	if !testMode {
		fmt.Println("\n🔗 Connecting to Bootstrap Manager for logger...")

		// Try to request logger from Bootstrap
		bootstrapIPCPath := GetBootstrapIPCPath()
		client := NewBootstrapIPCClient(bootstrapIPCPath)

		if err := client.Connect(5 * time.Second); err != nil {
			fmt.Printf("⚠️  Bootstrap unavailable (%v), using local logger\n", err)
		} else {
			defer client.Close()

			// Request logger for Node.js (nodejs runtime)
			resp, threadIDResponse, err := client.RequestLogger("emailService", "nodejs", []string{"info", "warn", "error"})
			if err != nil {
				fmt.Printf("⚠️  Failed to get logger from Bootstrap: %v\n", err)
			} else if resp != nil && resp.Status == "success" {
				threadID = threadIDResponse
				loggerCode = resp.LoggerCode

				fmt.Printf("✓ Logger received from Bootstrap\n")
				fmt.Printf("  Thread ID: %s\n", threadID)
				fmt.Printf("  Log Level: %s\n", resp.LogLevel)

				// Save logger code to a file for Node.js to use
				loggerPath := filepath.Join(exeDir, "dep", "logger.js")
				if err := ioutil.WriteFile(loggerPath, []byte(loggerCode), 0644); err != nil {
					fmt.Printf("⚠️  Failed to save logger file: %v\n", err)
				}
			}
		}

		// Pass logger info to Node.js via environment
		if threadID != "unknown" {
			env = append(env, "THREAD_ID="+threadID)
			env = append(env, "LOGGER_AVAILABLE=true")
			env = append(env, "LOGGER_PATH="+filepath.Join(exeDir, "dep", "logger.js"))
		}
	} else {
		env = append(env, "LOGGER_AVAILABLE=false")
	}

	// Start the Node.js process directly (no temp file)
	cmd := exec.Command(nodeExe, jsPath)
	cmd.Dir = exeDir // Set working directory to binary location for relative paths
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = env

	// Handle signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigChan
		fmt.Println("\n⚠️  Shutting down Email Service...")
		if cmd.Process != nil {
			cmd.Process.Signal(syscall.SIGINT)
		}
	}()

	// Run and wait
	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			os.Exit(exitErr.ExitCode())
		}
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}
}

// Check if a service is running
func isServiceRunning(host, port string, maxRetries int) bool {
	for i := 0; i < maxRetries; i++ {
		conn, err := net.DialTimeout("tcp", host+":"+port, 2*time.Second)
		if err == nil {
			conn.Close()
			return true
		}
		if i < maxRetries-1 {
			fmt.Printf("  Retry %d/%d...\n", i+1, maxRetries)
			time.Sleep(1 * time.Second)
		}
	}
	return false
}

// Simple random ID generator
func generateRandomID() string {
	b := make([]byte, 8)
	for i := range b {
		b[i] = "0123456789abcdef"[os.Getpid()%16]
	}
	return string(b)
}
