package main

import (
	"fmt"
	"io/ioutil"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func main() {
	fmt.Println("╔════════════════════════════════════════════════════╗")
	fmt.Println("║    🚀 Email Service - SMTP Server Wrapper          ║")
	fmt.Println("╚════════════════════════════════════════════════════╝")

	// Find the executable directory
	exePath, err := os.Executable()
	if err != nil {
		fmt.Printf("Error: Cannot determine executable path: %v\n", err)
		os.Exit(1)
	}

	exeDir := filepath.Dir(exePath)
	fmt.Printf("📍 Binary location: %s\n", exePath)

	// Look for JS file in /dep/ directory (relative to binary)
	jsPath := filepath.Join(exeDir, "dep", "smtp-server.js")
	if _, err := os.Stat(jsPath); err != nil {
		// Fallback: check if it's in the same directory as binary
		jsPath = filepath.Join(exeDir, "smtp-server.js")
		if _, err := os.Stat(jsPath); err != nil {
			// Last resort: check source directory (for development)
			jsPath = "../../node/email-sender/build/smtp-server.js"
			if _, err := os.Stat(jsPath); err != nil {
				fmt.Printf("\n❌ Error: Cannot find smtp-server.js\n")
				fmt.Printf("  Checked:\n")
				fmt.Printf("    - %s/dep/smtp-server.js\n", exeDir)
				fmt.Printf("    - %s/smtp-server.js\n", exeDir)
				fmt.Printf("    - ./../../node/email-sender/build/smtp-server.js\n")
				os.Exit(1)
			}
		}
	}

	fmt.Printf("📄 JS file: %s\n", jsPath)

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

	// Setup environment
	env := os.Environ()

	// Set NODE_PATH to local node_modules if they exist
	nodeModulesPath := filepath.Join(exeDir, "dep", "node_modules")
	if _, err := os.Stat(nodeModulesPath); err == nil {
		// Prepend to existing NODE_PATH if it exists
		existingNodePath := os.Getenv("NODE_PATH")
		if existingNodePath != "" {
			env = append(env, "NODE_PATH="+nodeModulesPath+string(filepath.ListSeparator)+existingNodePath)
		} else {
			env = append(env, "NODE_PATH="+nodeModulesPath)
		}
		fmt.Printf("📚 Using node_modules: %s\n", nodeModulesPath)
	}

	// Set CONFIG_PATH so the JS can find config files
	configPath := filepath.Join(exeDir, "config")
	env = append(env, "CONFIG_PATH="+configPath)
	fmt.Printf("⚙️  Config path: %s\n", configPath)

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
			resp, threadIDResponse, err := client.RequestLogger("emailSMTP", "nodejs", []string{"info", "warn", "error"})
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

	// Start the Node.js process DIRECTLY with the JS file
	// The JS file is NOT copied to temp - it's executed from the binary location
	cmd := exec.Command(nodeExe, jsPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = env
	cmd.Dir = exeDir // Set working directory to binary directory for relative paths

	// Handle signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigChan
		fmt.Println("\n⚠️  Shutting down SMTP server...")
		if cmd.Process != nil {
			cmd.Process.Signal(syscall.SIGINT)
		}
	}()

	// Run and wait
	fmt.Println("✓ Starting SMTP server...")
	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			os.Exit(exitErr.ExitCode())
		}
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}
}

// Simple random ID generator
func generateRandomID() string {
	b := make([]byte, 8)
	for i := range b {
		b[i] = "0123456789abcdef"[os.Getpid()%16]
	}
	return string(b)
}
