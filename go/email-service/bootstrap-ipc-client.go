package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// BootstrapIPCClient handles communication with Bootstrap Manager
type BootstrapIPCClient struct {
	endpoint   string
	httpClient *http.Client
	path       string
}

// LoggerRequestPayload is sent to Bootstrap
type LoggerRequestPayload struct {
	ServiceName string   `json:"service_name"`
	Runtime     string   `json:"runtime"`
	PID         int      `json:"pid"`
	Permissions []string `json:"permissions"`
}

// LoggerResponsePayload is received from Bootstrap
type LoggerResponsePayload struct {
	ServiceName   string `json:"service_name"`
	Runtime       string `json:"runtime"`
	ThreadID      string `json:"thread_id"`
	LoggerCode    string `json:"logger_code"`
	LoggerVersion string `json:"logger_version"`
	LogLevel      string `json:"log_level"`
	Format        string `json:"format"`
	Colorize      bool   `json:"colorize"`
	Status        string `json:"status"`
	Message       string `json:"message"`
}

// IPCMessage is the generic IPC protocol message
type IPCMessage struct {
	Type      string          `json:"type"`
	Timestamp time.Time       `json:"timestamp"`
	ServiceID string          `json:"service_id"`
	Payload   json.RawMessage `json:"payload"`
}

// NewBootstrapIPCClient creates a new client for Bootstrap communication
func NewBootstrapIPCClient(ipcPath string) *BootstrapIPCClient {
	return &BootstrapIPCClient{
		path:       ipcPath,
		httpClient: &http.Client{},
	}
}

// Connect connects to Bootstrap Manager via its HTTP API.
func (c *BootstrapIPCClient) Connect(timeout time.Duration) error {
	// Check environment variable override first
	if envEndpoint := os.Getenv("BOOTSTRAP_TCP_ENDPOINT"); envEndpoint != "" {
		return c.connectHTTP(envEndpoint, timeout)
	}

	// Determine if path is a file path or TCP endpoint
	endpoint := c.path

	// Check if this looks like a Windows/Unix file path
	if isFilePath(endpoint) {
		// Try to use as IPC socket file first
		if fileExists(endpoint) {
			// File exists but we're using TCP for Windows compatibility
			// Fall through to TCP conversion
		}
		// File path mode: use TCP fallback
		endpoint = "localhost:9000"
	} else if !isValidTCPEndpoint(endpoint) {
		// Not a file path and not valid TCP, default to localhost:9000
		endpoint = "localhost:9000"
	}

	return c.connectHTTP(endpoint, timeout)
}

// connectHTTP verifies the Bootstrap HTTP API is reachable.
func (c *BootstrapIPCClient) connectHTTP(endpoint string, timeout time.Duration) error {
	c.endpoint = strings.TrimPrefix(strings.TrimPrefix(endpoint, "http://"), "https://")
	c.httpClient.Timeout = timeout

	deadline := time.Now().Add(timeout)
	var lastErr error
	for {
		resp, err := c.httpClient.Get("http://" + c.endpoint + "/api/health")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return nil
			}
			lastErr = fmt.Errorf("bootstrap health check failed at %s: HTTP %d", c.endpoint, resp.StatusCode)
		} else {
			lastErr = fmt.Errorf("failed to connect to Bootstrap at %s: %v", c.endpoint, err)
		}

		if time.Now().After(deadline) {
			return lastErr
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// isFilePath checks if a string looks like a file path (Windows or Unix)
func isFilePath(path string) bool {
	// Windows: contains backslash or starts with drive letter (e.g., C:)
	if strings.Contains(path, "\\") {
		return true
	}
	// Unix: ends with .sock or starts with /
	if strings.HasSuffix(path, ".sock") || strings.HasPrefix(path, "/") {
		return true
	}
	// Windows drive letter check (C:, D:, etc.)
	if len(path) > 1 && path[1] == ':' && strings.ContainsAny(string(path[0]), "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz") {
		// But not if it's clearly host:port (only one colon and what follows is a port)
		if colons := strings.Count(path, ":"); colons == 1 {
			// Single colon - could be drive letter, check port part
			parts := strings.Split(path, ":")
			if _, err := strconv.Atoi(parts[1]); err == nil && len(parts[1]) <= 5 {
				// Valid port number, this is TCP
				return false
			}
		}
		return true
	}
	return false
}

// fileExists checks if a file path exists
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// isValidTCPEndpoint checks if the path is a valid TCP endpoint (host:port)
func isValidTCPEndpoint(path string) bool {
	// Must contain exactly one colon (for host:port)
	colonCount := strings.Count(path, ":")
	if colonCount != 1 {
		return false
	}

	parts := strings.Split(path, ":")
	if len(parts) != 2 {
		return false
	}

	host := strings.TrimSpace(parts[0])
	portStr := strings.TrimSpace(parts[1])

	// Host cant be empty
	if host == "" {
		return false
	}

	// Port must be a valid number between 1-65535
	port, err := strconv.Atoi(portStr)
	if err != nil || port < 1 || port > 65535 {
		return false
	}

	return true
}

// RequestLogger asks Bootstrap for a compiled logger for the specified runtime
func (c *BootstrapIPCClient) RequestLogger(serviceName string, runtime string, permissions []string) (*LoggerResponsePayload, string, error) {
	if c.endpoint == "" {
		return nil, "", fmt.Errorf("not connected to Bootstrap")
	}

	// Create request
	payload := LoggerRequestPayload{
		ServiceName: serviceName,
		Runtime:     runtime,
		PID:         os.Getpid(),
		Permissions: permissions,
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, "", fmt.Errorf("failed to marshal logger request: %v", err)
	}

	msg := IPCMessage{
		Type:      "LOGGER_REQUEST",
		Timestamp: time.Now(),
		ServiceID: serviceName,
		Payload:   payloadBytes,
	}

	msgBytes, err := json.Marshal(msg)
	if err != nil {
		return nil, "", fmt.Errorf("failed to marshal IPC message: %v", err)
	}

	respHTTP, err := c.httpClient.Post(
		"http://"+c.endpoint+"/logger/request",
		"application/json",
		bytes.NewReader(msgBytes),
	)
	if err != nil {
		return nil, "", fmt.Errorf("failed to send logger request: %v", err)
	}
	defer respHTTP.Body.Close()

	respBytes, err := io.ReadAll(respHTTP.Body)
	if err != nil {
		return nil, "", fmt.Errorf("failed to read logger response: %v", err)
	}
	if respHTTP.StatusCode < 200 || respHTTP.StatusCode >= 300 {
		return nil, "", fmt.Errorf("logger request failed: HTTP %d: %s", respHTTP.StatusCode, strings.TrimSpace(string(respBytes)))
	}

	var respMsg IPCMessage
	if err := json.Unmarshal(respBytes, &respMsg); err != nil {
		return nil, "", fmt.Errorf("failed to unmarshal response: %v", err)
	}

	var resp LoggerResponsePayload
	if err := json.Unmarshal(respMsg.Payload, &resp); err != nil {
		return nil, "", fmt.Errorf("failed to unmarshal logger response: %v", err)
	}

	if resp.Status != "success" {
		return nil, "", fmt.Errorf("logger request failed: %s", resp.Message)
	}

	return &resp, resp.ThreadID, nil
}

// Close closes the IPC connection
func (c *BootstrapIPCClient) Close() error {
	return nil
}

// WriteLoggerToFile writes the logger code to a temporary file for source maps or debugging
func WriteLoggerToFile(loggerCode string, outputPath string) error {
	return ioutil.WriteFile(outputPath, []byte(loggerCode), 0644)
}

// GetBootstrapIPCPath returns the TCP endpoint for Bootstrap Manager
// Can be configured via BOOTSTRAP_IPC_PATH or BOOTSTRAP_TCP_ENDPOINT environment variables
// Default: localhost:9000
func GetBootstrapIPCPath() string {
	// Check for TCP endpoint first
	if endpoint := os.Getenv("BOOTSTRAP_TCP_ENDPOINT"); endpoint != "" {
		return endpoint
	}

	// Check for legacy path (will be converted to TCP in Connect())
	if ipcPath := os.Getenv("BOOTSTRAP_IPC_PATH"); ipcPath != "" {
		return ipcPath
	}

	// Default TCP endpoint
	return "localhost:9000"
}
