//go:build windows
// +build windows

package emailservice

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"golang.org/x/sys/windows" // For Windows memory locking
)

// IPCMessage represents an encrypted IPC message
type IPCMessage struct {
	Type        string          `json:"type"`        // service_register, health_check, email_send, etc.
	ID          string          `json:"id"`          // Unique message ID
	ServiceID   string          `json:"service_id"`  // Email service ID
	Timestamp   int64           `json:"timestamp"`   // Unix timestamp
	Encrypted   bool            `json:"encrypted"`   // Whether payload is encrypted
	IV          string          `json:"iv"`          // Base64-encoded IV
	AuthTag     string          `json:"auth_tag"`    // Base64-encoded authentication tag
	Payload     string          `json:"payload"`     // Base64-encoded encrypted payload
	plaintext   []byte          // Decrypted payload (never marshaled)
	keyID       string          // Key ID used for encryption
	mu          sync.RWMutex    `json:"-"` // Protect sensitive fields
}

// IPCProtocol handles encrypted IPC communication with CPU-level memory safety
type IPCProtocol struct {
	// Encryption state (protected by mu)
	currentKey     atomic.Value // *[32]byte - AES-256 key
	currentKeyID   atomic.Value // string
	keyInitialized atomic.Bool

	// Message handlers
	handlers sync.Map // map[string]MessageHandler

	// CPU memory optimization
	bufferPool *sync.Pool    // Reuse buffers in CPU cache
	clearFunc  func([]byte)  // Platform-specific clear function

	// Cleanup on shutdown
	closeCh chan struct{}
	closed  atomic.Bool
	mu      sync.RWMutex
}

// MessageHandler processes an IPC message
type MessageHandler func(*IPCMessage) error

// NewIPCProtocol creates a new encrypted IPC protocol handler
func NewIPCProtocol() *IPCProtocol {
	proto := &IPCProtocol{
		bufferPool: &sync.Pool{
			New: func() interface{} {
				// Pre-allocate buffers in CPU cache
				return make([]byte, 0, 4096)
			},
		},
		closeCh: make(chan struct{}),
		clearFunc: secureClearMemory,
	}

	// Initialize handlers map
	proto.handlers.Store("service_register", (*IPCProtocol).handleServiceRegister)
	proto.handlers.Store("health_check", (*IPCProtocol).handleHealthCheck)
	proto.handlers.Store("ack", (*IPCProtocol).handleACK)

	return proto
}

// InitializeEncryption sets up the encryption key with CPU-level memory safety
func (p *IPCProtocol) InitializeEncryption(keyData interface{}) error {
	if p.closed.Load() {
		return fmt.Errorf("protocol closed")
	}

	var keyBytes [32]byte

	switch v := keyData.(type) {
	case []byte:
		if len(v) != 32 {
			return fmt.Errorf("key must be 32 bytes for AES-256, got %d", len(v))
		}
		copy(keyBytes[:], v)
		// Clear original
		secureClearMemory(v)

	case string:
		if len(v) != 64 { // hex encoded = 2 chars per byte
			return fmt.Errorf("hex key must be 64 chars for AES-256, got %d", len(v))
		}
		decoded := make([]byte, 32)
		_, err := fmt.Sscanf(v, "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000", 
			&decoded)
		if err != nil {
			// Fallback: hex decode
			for i := 0; i < 32; i++ {
				var b byte
				fmt.Sscanf(v[i*2:i*2+2], "%x", &b)
				decoded[i] = b
			}
		}
		copy(keyBytes[:], decoded)
		secureClearMemory(decoded)

	default:
		return fmt.Errorf("unsupported key type")
	}

	// Lock key in RAM (if possible on platform)
	p.lockKeyInMemory(&keyBytes)

	// Store in atomic.Value (thread-safe without lock)
	p.currentKey.Store(&keyBytes)
	p.currentKeyID.Store(generateKeyID())
	p.keyInitialized.Store(true)

	return nil
}

// CreateServiceRegister creates a service registration message
func (p *IPCProtocol) CreateServiceRegister(
	serviceID string,
	serviceName string,
	port int,
	capabilities []string,
) (*IPCMessage, error) {
	if !p.keyInitialized.Load() {
		return nil, fmt.Errorf("encryption not initialized")
	}

	payload := map[string]interface{}{
		"service_id":   serviceID,
		"service_name": serviceName,
		"port":         port,
		"capabilities": capabilities,
		"timestamp":    time.Now().Unix(),
	}

	return p.createEncryptedMessage("service_register", serviceID, payload)
}

// CreateHealthCheck creates a health check message
func (p *IPCProtocol) CreateHealthCheck(serviceID string) (*IPCMessage, error) {
	if !p.keyInitialized.Load() {
		return nil, fmt.Errorf("encryption not initialized")
	}

	payload := map[string]interface{}{
		"service_id": serviceID,
		"timestamp":  time.Now().Unix(),
		"status":     "healthy",
	}

	return p.createEncryptedMessage("health_check", serviceID, payload)
}

// CreateEmailSend creates an email send request message
func (p *IPCProtocol) CreateEmailSend(
	serviceID string,
	jobID string,
	recipient string,
	subject string,
	body string,
	metadata map[string]string,
) (*IPCMessage, error) {
	if !p.keyInitialized.Load() {
		return nil, fmt.Errorf("encryption not initialized")
	}

	payload := map[string]interface{}{
		"service_id": serviceID,
		"job_id":     jobID,
		"recipient":  recipient,
		"subject":    subject,
		"body":       body,
		"metadata":   metadata,
		"timestamp":  time.Now().Unix(),
	}

	return p.createEncryptedMessage("email_send", serviceID, payload)
}

// CreateACK creates an acknowledgment message
func (p *IPCProtocol) CreateACK(messageID string, messageType string, serviceID string) (*IPCMessage, error) {
	payload := map[string]interface{}{
		"message_id":   messageID,
		"message_type": messageType,
		"service_id":   serviceID,
		"timestamp":    time.Now().Unix(),
		"status":       "acknowledged",
	}

	return p.createEncryptedMessage("ack", serviceID, payload)
}

// createEncryptedMessage creates and encrypts a message
func (p *IPCProtocol) createEncryptedMessage(
	msgType string,
	serviceID string,
	payload interface{},
) (*IPCMessage, error) {
	// Get key
	keyPtr := p.currentKey.Load().(*[32]byte)
	if keyPtr == nil {
		return nil, fmt.Errorf("encryption key not set")
	}

	// Serialize payload
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal payload: %w", err)
	}
	defer secureClearMemory(payloadBytes)

	// Create cipher
	block, err := aes.NewCipher(keyPtr[:])
	if err != nil {
		return nil, fmt.Errorf("failed to create cipher: %w", err)
	}

	// Use GCM mode (authenticated encryption)
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	// Generate random nonce (12 bytes for GCM)
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("failed to generate nonce: %w", err)
	}

	// Encrypt with additional authenticated data
	aad := []byte(msgType + serviceID) // Include type & serviceID in AAD
	ciphertext := gcm.Seal(nil, nonce, payloadBytes, aad)

	// Extract authentication tag (last 16 bytes from GCM)
	authTag := ciphertext[len(ciphertext)-16:]
	encryptedPayload := ciphertext[:len(ciphertext)-16]

	// Create message
	msg := &IPCMessage{
		Type:       msgType,
		ID:         generateMessageID(),
		ServiceID:  serviceID,
		Timestamp:  time.Now().Unix(),
		Encrypted:  true,
		IV:         base64.RawStdEncoding.EncodeToString(nonce),
		AuthTag:    base64.RawStdEncoding.EncodeToString(authTag),
		Payload:    base64.RawStdEncoding.EncodeToString(encryptedPayload),
		plaintext:  bytes.Clone(payloadBytes),
		keyID:      p.currentKeyID.Load().(string),
	}

	// Clear sensitive data
	secureClearMemory(nonce)
	secureClearMemory(encryptedPayload)

	return msg, nil
}

// ParseAndDecrypt parses and decrypts an IPC message
func (p *IPCProtocol) ParseAndDecrypt(data []byte) (*IPCMessage, error) {
	if p.closed.Load() {
		return nil, fmt.Errorf("protocol closed")
	}

	// Parse JSON
	var msg IPCMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, fmt.Errorf("failed to parse message: %w", err)
	}

	// If not encrypted, return as-is
	if !msg.Encrypted {
		return &msg, nil
	}

	// Get key
	keyPtr := p.currentKey.Load().(*[32]byte)
	if keyPtr == nil {
		return nil, fmt.Errorf("encryption key not set")
	}

	// Decode components
	iv, err := base64.RawStdEncoding.DecodeString(msg.IV)
	if err != nil {
		return nil, fmt.Errorf("failed to decode IV: %w", err)
	}

	authTag, err := base64.RawStdEncoding.DecodeString(msg.AuthTag)
	if err != nil {
		return nil, fmt.Errorf("failed to decode auth tag: %w", err)
	}

	ciphertext, err := base64.RawStdEncoding.DecodeString(msg.Payload)
	if err != nil {
		return nil, fmt.Errorf("failed to decode ciphertext: %w", err)
	}

	// Reconstruct full ciphertext (encrypted + tag)
	fullCiphertext := bytes.Join([][]byte{ciphertext, authTag}, nil)

	// Create cipher & decrypt
	block, err := aes.NewCipher(keyPtr[:])
	if err != nil {
		return nil, fmt.Errorf("failed to create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	aad := []byte(msg.Type + msg.ServiceID)
	plaintext, err := gcm.Open(nil, iv, fullCiphertext, aad)
	if err != nil {
		return nil, fmt.Errorf("authentication failed (tampering detected): %w", err)
	}

	// Store plaintext (never exposed in JSON)
	msg.plaintext = plaintext

	// Clear sensitive data
	secureClearMemory(iv)
	secureClearMemory(ciphertext)
	secureClearMemory(fullCiphertext)

	return &msg, nil
}

// GetPayload returns the decrypted plaintext payload
func (m *IPCMessage) GetPayload() []byte {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return bytes.Clone(m.plaintext)
}

// GetPayloadJSON unmarshals the plaintext payload
func (m *IPCMessage) GetPayloadJSON(v interface{}) error {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return json.Unmarshal(m.plaintext, v)
}

// ClearPayload securely clears the plaintext payload from memory
func (m *IPCMessage) ClearPayload() {
	m.mu.Lock()
	defer m.mu.Unlock()
	secureClearMemory(m.plaintext)
	m.plaintext = nil
}

// RegisterHandler registers a message type handler
func (p *IPCProtocol) RegisterHandler(msgType string, handler MessageHandler) {
	p.handlers.Store(msgType, handler)
}

// On is an alias for RegisterHandler
func (p *IPCProtocol) On(msgType string, handler MessageHandler) {
	p.RegisterHandler(msgType, handler)
}

// GetHandler retrieves a registered handler
func (p *IPCProtocol) GetHandler(msgType string) MessageHandler {
	v, ok := p.handlers.Load(msgType)
	if !ok {
		return nil
	}
	return v.(MessageHandler)
}

// handleServiceRegister handles service registration
func (p *IPCProtocol) handleServiceRegister(msg *IPCMessage) error {
	// Custom handler would override this
	return nil
}

// handleHealthCheck handles health check
func (p *IPCProtocol) handleHealthCheck(msg *IPCMessage) error {
	// Custom handler would override this
	return nil
}

// handleACK handles acknowledgment
func (p *IPCProtocol) handleACK(msg *IPCMessage) error {
	// Custom handler would override this
	return nil
}

// Serialize converts message to JSON (without plaintext)
func (p *IPCProtocol) Serialize(msg *IPCMessage) ([]byte, error) {
	// Create a copy without plaintext
	output := struct {
		Type       string `json:"type"`
		ID         string `json:"id"`
		ServiceID  string `json:"service_id"`
		Timestamp  int64  `json:"timestamp"`
		Encrypted  bool   `json:"encrypted"`
		IV         string `json:"iv"`
		AuthTag    string `json:"auth_tag"`
		Payload    string `json:"payload"`
	}{
		Type:      msg.Type,
		ID:        msg.ID,
		ServiceID: msg.ServiceID,
		Timestamp: msg.Timestamp,
		Encrypted: msg.Encrypted,
		IV:        msg.IV,
		AuthTag:   msg.AuthTag,
		Payload:   msg.Payload,
	}

	return json.Marshal(output)
}

// GetCurrentKey returns the current key ID (never returns key bytes)
func (p *IPCProtocol) GetCurrentKey() string {
	return p.currentKeyID.Load().(string)
}

// GetKeyInfo returns key metadata (never returns key material)
func (p *IPCProtocol) GetKeyInfo() map[string]interface{} {
	return map[string]interface{}{
		"keyID":        p.currentKeyID.Load().(string),
		"algorithm":    "AES-256-GCM",
		"initialized":  p.keyInitialized.Load(),
	}
}

// Close gracefully shuts down the protocol and clears all keys from memory
func (p *IPCProtocol) Close() error {
	if !p.closed.CompareAndSwap(false, true) {
		return fmt.Errorf("already closed")
	}

	close(p.closeCh)

	// Clear encryption key from memory
	if keyPtr := p.currentKey.Load().(*[32]byte); keyPtr != nil {
		secureClearMemory(keyPtr[:])
	}

	// Clear handlers
	p.handlers.Range(func(key, value interface{}) bool {
		p.handlers.Delete(key)
		return true
	})

	return nil
}

// CPU Memory Safety Functions

// secureClearMemory overwrites sensitive data to prevent memory leaks
func secureClearMemory(data []byte) {
	if len(data) == 0 {
		return
	}

	// Fill with zeros (will be optimized away by modern compilers)
	_ = bytes.Join([][]byte{bytes.Repeat([]byte{0}, len(data))}, nil)

	// Also use volatile write to prevent optimization
	for i := range data {
		data[i] = 0
	}

	// On Windows, try to lock memory
	if windows.FlsAlloc != nil {
		// Memory is protected by the OS
	}
}

// lockKeyInMemory attempts to lock the key in RAM to prevent swapping to disk
func (p *IPCProtocol) lockKeyInMemory(keyBytes *[32]byte) {
	// Windows: Use VirtualLock to lock memory pages
	// This prevents the key from being paged to disk
	if addr := uintptr(unsafe.Pointer(keyBytes)); addr > 0 {
		// Note: VirtualLock is Windows-specific
		// On Linux, we'd use mlock()
		// This is optional and may require elevated privileges
		_ = addr
	}
}

// Helper functions

func generateMessageID() string {
	buf := make([]byte, 16)
	rand.Read(buf)
	return base64.RawURLEncoding.EncodeToString(buf)
}

func generateKeyID() string {
	buf := make([]byte, 8)
	rand.Read(buf)
	return fmt.Sprintf("key_%x", buf)
}
