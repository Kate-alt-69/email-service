package emailservice

import (
	"crypto/aes"
	"crypto/rand"
	"encoding/json"
	"testing"
)

func TestIPCProtocolInitialization(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	// Test with 32-byte key
	key := make([]byte, 32)
	rand.Read(key)

	err := proto.InitializeEncryption(key)
	if err != nil {
		t.Fatalf("Failed to initialize encryption: %v", err)
	}

	if !proto.keyInitialized.Load() {
		t.Fatal("Key not marked as initialized")
	}

	keyInfo := proto.GetKeyInfo()
	if !keyInfo["initialized"].(bool) {
		t.Fatal("Key info shows not initialized")
	}
}

func TestIPCProtocolInitializationWithHex(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	// Generate key and convert to hex
	keyBytes := make([]byte, 32)
	rand.Read(keyBytes)

	// Convert to hex string (64 characters)
	hexKey := make([]byte, 64)
	for i := 0; i < 32; i++ {
		b := keyBytes[i]
		hexKey[i*2] = "0123456789abcdef"[b>>4]
		hexKey[i*2+1] = "0123456789abcdef"[b&0x0f]
	}

	err := proto.InitializeEncryption(string(hexKey))
	if err != nil {
		t.Fatalf("Failed to initialize encryption with hex: %v", err)
	}

	if !proto.keyInitialized.Load() {
		t.Fatal("Key not marked as initialized")
	}
}

func TestIPCProtocolInvalidKeyLength(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	// Test with wrong key size
	shortKey := make([]byte, 16) // 128 bits instead of 256
	rand.Read(shortKey)

	err := proto.InitializeEncryption(shortKey)
	if err == nil {
		t.Fatal("Should reject invalid key length")
	}
}

func TestCreateServiceRegister(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	msg, err := proto.CreateServiceRegister(
		"email-service",
		"Email Service",
		3000,
		[]string{"send", "verify"},
	)

	if err != nil {
		t.Fatalf("Failed to create service register message: %v", err)
	}

	if msg.Type != "service_register" {
		t.Fatalf("Wrong message type: %s", msg.Type)
	}

	if !msg.Encrypted {
		t.Fatal("Message should be encrypted")
	}

	if msg.IV == "" || msg.AuthTag == "" || msg.Payload == "" {
		t.Fatal("Encryption fields missing")
	}
}

func TestCreateHealthCheck(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	msg, err := proto.CreateHealthCheck("email-service")
	if err != nil {
		t.Fatalf("Failed to create health check: %v", err)
	}

	if msg.Type != "health_check" {
		t.Fatalf("Wrong message type: %s", msg.Type)
	}

	if !msg.Encrypted {
		t.Fatal("Message should be encrypted")
	}
}

func TestCreateEmailSend(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	metadata := map[string]string{"theme": "dark"}
	msg, err := proto.CreateEmailSend(
		"email-service",
		"job-123",
		"user@example.com",
		"Test Subject",
		"Test Body",
		metadata,
	)

	if err != nil {
		t.Fatalf("Failed to create email send: %v", err)
	}

	if msg.Type != "email_send" {
		t.Fatalf("Wrong message type: %s", msg.Type)
	}

	if !msg.Encrypted {
		t.Fatal("Message should be encrypted")
	}
}

func TestCreateACK(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	msg, err := proto.CreateACK("msg-123", "service_register", "email-service")
	if err != nil {
		t.Fatalf("Failed to create ACK: %v", err)
	}

	if msg.Type != "ack" {
		t.Fatalf("Wrong message type: %s", msg.Type)
	}
}

func TestMessageIDUniqueness(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	msg1, _ := proto.CreateHealthCheck("svc")
	msg2, _ := proto.CreateHealthCheck("svc")

	if msg1.ID == msg2.ID {
		t.Fatal("Message IDs should be unique")
	}
}

func TestIVUniqueness(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	msg1, _ := proto.CreateHealthCheck("svc")
	msg2, _ := proto.CreateHealthCheck("svc")

	if msg1.IV == msg2.IV {
		t.Fatal("IVs should be unique")
	}
}

func TestEncryptAndDecrypt(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	// Create and encrypt message
	originalMsg, _ := proto.CreateServiceRegister(
		"email-service",
		"Email Service",
		3000,
		[]string{"send"},
	)

	// Serialize
	serialized, _ := json.Marshal(originalMsg)

	// Parse and decrypt
	decrypted, err := proto.ParseAndDecrypt(serialized)
	if err != nil {
		t.Fatalf("Failed to decrypt: %v", err)
	}

	if decrypted.Type != originalMsg.Type {
		t.Fatalf("Type mismatch: %s != %s", decrypted.Type, originalMsg.Type)
	}

	if decrypted.ServiceID != originalMsg.ServiceID {
		t.Fatalf("ServiceID mismatch: %s != %s", decrypted.ServiceID, originalMsg.ServiceID)
	}

	// Verify plaintext payload
	var payload map[string]interface{}
	err = json.Unmarshal(decrypted.GetPayload(), &payload)
	if err != nil {
		t.Fatalf("Failed to unmarshal plaintext: %v", err)
	}

	if payload["service_id"].(string) != "email-service" {
		t.Fatal("Service ID mismatch in plaintext")
	}
}

func TestDecryptEmailSend(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	// Create email send message
	msg, _ := proto.CreateEmailSend(
		"email-service",
		"job-456",
		"user@example.com",
		"Reset Password",
		"Click here...",
		map[string]string{"locale": "en"},
	)

	serialized, _ := json.Marshal(msg)
	decrypted, _ := proto.ParseAndDecrypt(serialized)

	// Check plaintext
	var payload map[string]interface{}
	json.Unmarshal(decrypted.GetPayload(), &payload)

	if payload["job_id"].(string) != "job-456" {
		t.Fatal("Job ID mismatch")
	}

	if payload["recipient"].(string) != "user@example.com" {
		t.Fatal("Recipient mismatch")
	}
}

func TestAuthenticationFailure(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	// Create and encrypt message
	msg, _ := proto.CreateServiceRegister("svc", "Svc", 3000, nil)

	// Tamper with ciphertext
	msg.Payload = "AAAA" // Invalid base64-like data

	serialized, _ := json.Marshal(msg)

	// Should fail to authenticate
	_, err := proto.ParseAndDecrypt(serialized)
	if err == nil {
		t.Fatal("Should reject tampered message")
	}
}

func TestDifferentKeys(t *testing.T) {
	proto1 := NewIPCProtocol()
	defer proto1.Close()

	proto2 := NewIPCProtocol()
	defer proto2.Close()

	key1 := make([]byte, 32)
	key2 := make([]byte, 32)
	rand.Read(key1)
	rand.Read(key2)

	proto1.InitializeEncryption(key1)
	proto2.InitializeEncryption(key2)

	// Encrypt with proto1
	msg, _ := proto1.CreateServiceRegister("svc", "Svc", 3000, nil)
	serialized, _ := json.Marshal(msg)

	// Try to decrypt with proto2 (different key)
	_, err := proto2.ParseAndDecrypt(serialized)
	if err == nil {
		t.Fatal("Should fail with different key")
	}
}

func TestSameKeyDecryption(t *testing.T) {
	proto1 := NewIPCProtocol()
	defer proto1.Close()

	proto2 := NewIPCProtocol()
	defer proto2.Close()

	key := make([]byte, 32)
	rand.Read(key)

	keyHex := make([]byte, 64)
	for i := 0; i < 32; i++ {
		b := key[i]
		keyHex[i*2] = "0123456789abcdef"[b>>4]
		keyHex[i*2+1] = "0123456789abcdef"[b&0x0f]
	}

	proto1.InitializeEncryption(key)
	proto2.InitializeEncryption(string(keyHex))

	// Encrypt with proto1
	msg, _ := proto1.CreateServiceRegister("svc", "Svc", 3000, nil)
	serialized, _ := json.Marshal(msg)

	// Decrypt with proto2 (same key)
	decrypted, err := proto2.ParseAndDecrypt(serialized)
	if err != nil {
		t.Fatalf("Failed to decrypt with same key: %v", err)
	}

	if decrypted.Type != "service_register" {
		t.Fatal("Type mismatch")
	}
}

func TestGetPayload(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	msg, _ := proto.CreateServiceRegister("svc", "Svc", 3000, []string{"send"})
	serialized, _ := json.Marshal(msg)

	decrypted, _ := proto.ParseAndDecrypt(serialized)
	payload := decrypted.GetPayload()

	if len(payload) == 0 {
		t.Fatal("Payload is empty")
	}

	var data map[string]interface{}
	json.Unmarshal(payload, &data)

	if data["service_id"].(string) != "svc" {
		t.Fatal("Service ID mismatch in payload")
	}
}

func TestGetPayloadJSON(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	msg, _ := proto.CreateServiceRegister("svc", "Svc", 3000, nil)
	serialized, _ := json.Marshal(msg)

	decrypted, _ := proto.ParseAndDecrypt(serialized)

	var data map[string]interface{}
	err := decrypted.GetPayloadJSON(&data)
	if err != nil {
		t.Fatalf("Failed to unmarshal payload: %v", err)
	}

	if data["service_id"].(string) != "svc" {
		t.Fatal("Service ID mismatch")
	}
}

func TestMessageHandlers(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	handlerCalled := false
	testHandler := func(msg *IPCMessage) error {
		handlerCalled = true
		return nil
	}

	proto.RegisterHandler("test_type", testHandler)
	handler := proto.GetHandler("test_type")

	if handler == nil {
		t.Fatal("Handler not registered")
	}

	handler(nil)
	if !handlerCalled {
		t.Fatal("Handler was not called")
	}
}

func TestClose(t *testing.T) {
	proto := NewIPCProtocol()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	proto.Close()

	// Should fail after close
	_, err := proto.CreateHealthCheck("svc")
	if err == nil {
		t.Fatal("Should fail after close")
	}
}

func TestMemorySafety(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	// Create messages and verify they don't leak
	for i := 0; i < 100; i++ {
		msg, err := proto.CreateHealthCheck("svc")
		if err != nil {
			t.Fatalf("Failed at iteration %d: %v", i, err)
		}
		if msg == nil {
			t.Fatal("Message is nil")
		}
	}
}

func TestConcurrentEncryption(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	done := make(chan bool, 10)

	// Launch multiple goroutines
	for i := 0; i < 10; i++ {
		go func(id int) {
			for j := 0; j < 10; j++ {
				msg, err := proto.CreateHealthCheck("svc")
				if err != nil || msg == nil {
					t.Errorf("Goroutine %d failed at iteration %d", id, j)
					return
				}
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}
}

func TestNoKeyExposure(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	info := proto.GetKeyInfo()

	// Check that key material is not in the info
	for _, v := range info {
		if _, ok := v.([]byte); ok {
			t.Fatal("Key material should not be in KeyInfo")
		}
	}

	if info["keyID"] == "" {
		t.Fatal("Key ID should be set")
	}
}

func TestSerialization(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	msg, _ := proto.CreateServiceRegister("svc", "Svc", 3000, nil)

	// Should be able to serialize
	serialized, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("Failed to serialize: %v", err)
	}

	// Should be valid JSON
	var decoded map[string]interface{}
	err = json.Unmarshal(serialized, &decoded)
	if err != nil {
		t.Fatalf("Failed to decode: %v", err)
	}
}

func TestGetCurrentKey(t *testing.T) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	keyId := proto.GetCurrentKey()
	if keyId == "" {
		t.Fatal("Key ID should not be empty")
	}

	if !proto.keyInitialized.Load() {
		t.Fatal("Key should be initialized")
	}
}

// Benchmarks

func BenchmarkEncryption(b *testing.B) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		proto.CreateHealthCheck("svc")
	}
}

func BenchmarkDecryption(b *testing.B) {
	proto := NewIPCProtocol()
	defer proto.Close()

	key := make([]byte, 32)
	rand.Read(key)
	proto.InitializeEncryption(key)

	msg, _ := proto.CreateServiceRegister("svc", "Svc", 3000, nil)
	serialized, _ := json.Marshal(msg)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		proto.ParseAndDecrypt(serialized)
	}
}

func BenchmarkAES256GCM(b *testing.B) {
	key := make([]byte, 32)
	rand.Read(key)

	block, _ := aes.NewCipher(key)
	gcm, _ := NewGCMWithNonceSize(block, 12)

	nonce := make([]byte, 12)
	plaintext := make([]byte, 1024)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rand.Read(nonce)
		gcm.Seal(nil, nonce, plaintext, nil)
	}
}
