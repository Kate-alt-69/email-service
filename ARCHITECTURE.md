# 📬 Email Service Architecture & Design

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                      CLIENT APPLICATIONS                          │
│ (Your Backend, Frontend, Admin Dashboard, etc.)                   │
└───────────────────────┬──────────────────────────────────────────┘
                        │
        ┌───────────────┴────────────────┐
        │                                │
        │ HTTP API Calls                 │
        │ (JSON)                         │
        │                                │
        ▼                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                  NODE.JS EMAIL SERVICE                            │
│ (Express API on port 3001)                                        │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Express Routes                                             │ │
│  │ ├─ POST /email/send (simple)                              │ │
│  │ ├─ POST /email/send-template                              │ │
│  │ ├─ POST /email/verification                               │ │
│  │ ├─ POST /email/password-reset                             │ │
│  │ ├─ POST /email/welcome                                    │ │
│  │ ├─ POST /email/order-confirmation                         │ │
│  │ ├─ POST /email/notify                                     │ │
│  │ └─ GET /health                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                           │                                      │
│  ┌────────────────────────▼────────────────────────────────────┐ │
│  │ Email Service Layer                                        │ │
│  │ (TypeScript Classes)                                       │ │
│  │ ├─ sendSimpleEmail()                                       │ │
│  │ ├─ sendTemplateEmail()                                     │ │
│  │ ├─ sendVerificationEmail()                                 │ │
│  │ ├─ sendPasswordResetEmail()                                │ │
│  │ ├─ sendWelcomeEmail()                                      │ │
│  │ ├─ sendOrderConfirmationEmail()                            │ │
│  │ └─ sendNotificationEmail()                                 │ │
│  └────────────────────────┬────────────────────────────────────┘ │
│                           │                                      │
│  ┌────────────────────────▼────────────────────────────────────┐ │
│  │ Nodemailer Configuration                                   │ │
│  │ (SMTP Connection Management)                               │ │
│  │ ├─ initializeEmailTransporter()                            │ │
│  │ ├─ sendEmail()                                             │ │
│  │ ├─ verifyTransporter()                                     │ │
│  │ └─ getTransporter()                                        │ │
│  └────────────────────────┬────────────────────────────────────┘ │
└────────────────────────────┼───────────────────────────────────────┘
                             │
        ┌────────────────────┴──────────────────┐
        │                                       │
        │ SMTP Protocol                         │
        │ (localhost:25)                        │
        │                                       │
        ▼                                       ▼
┌──────────────────────┐              ┌──────────────────────┐
│   POSTFIX SMTP       │              │   REDIS QUEUE       │
│   (Mail Server)      │              │   (Optional)         │
│                      │              │                      │
│ ├─ Queue emails      │              │ ├─ Store jobs       │
│ ├─ Route mail        │              │ ├─ Retry failed     │
│ ├─ Retry delivery    │              │ ├─ Rate limiting    │
│ └─ Handle bounces    │              │ └─ Load balancing   │
└──────────────┬───────┘              └──────────────────────┘
               │
        ┌──────┴─────────┐
        │                │
        ▼                ▼
     SMTP                IMAP
    (Send)             (Receive -
                       Optional)
        │                │
        ▼                ▼
    ┌──────────────────────────────────┐
    │ Internet (Gmail, Outlook, etc.)  │
    └──────────────────────────────────┘
```

## Component Architecture

### 1. **Go Service Bootstrap** (`go/service-bootstrap/main.go`)

**Purpose:** Process manager for all services

**Responsibilities:**
- Start and monitor all services
- Restart services on crash (with max retries)
- Handle graceful shutdown
- Log service status

**Key Features:**
- Runs services in isolated goroutines
- Watches for SIGTERM/SIGINT signals
- Configurable retry delays
- Concurrent service management

```
ServiceManager
├── services map[string]*Service
├── Start()           // start all and watch for signals
├── runService()      // keep service alive
└── StopAll()         // graceful shutdown
```

### 2. **Node.js Email Service** (`node/email-sender/`)

#### A. Express API Server (`src/index.ts`)

**Endpoints:**

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/health` | Health check |
| POST | `/email/send` | Send simple email |
| POST | `/email/send-template` | Send with template |
| POST | `/email/verification` | Verification email |
| POST | `/email/password-reset` | Password reset email |
| POST | `/email/welcome` | Welcome email |
| POST | `/email/order-confirmation` | Order confirmation |
| POST | `/email/notify` | Generic notification |

**Request/Response Pattern:**
```typescript
// Request
{
  to: string | string[]
  subject: string
  html: string
  text?: string
  from?: string
  cc?: string[]
  bcc?: string[]
}

// Response
{
  success: boolean
  messageId?: string
  error?: string
}
```

#### B. Email Service (`src/services/emailService.ts`)

**Class Methods:**
```typescript
class EmailService {
  sendSimpleEmail()
  sendTemplateEmail()
  sendVerificationEmail()
  sendPasswordResetEmail()
  sendWelcomeEmail()
  sendOrderConfirmationEmail()
  sendNotificationEmail()
}
```

**Features:**
- Template rendering with variable substitution
- Pre-built email templates
- Consistent HTML formatting
- Error handling and logging

#### C. Nodemailer Config (`src/config/nodemailerConfig.ts`)

**Transporter Management:**
```typescript
initializeEmailTransporter()  // Create SMTP connection
verifyTransporter()           // Test connection
sendEmail()                   // Send via nodemailer
getTransporter()              // Get instance
```

**SMTP Configuration:**
```env
SMTP_HOST=localhost
SMTP_PORT=25
SMTP_SECURE=false
SMTP_IGNORE_TLS=true
SMTP_USER=optional
SMTP_PASSWORD=optional
```

#### D. Logger (`src/config/logger.ts`)

**Uses:** Pino.js for structured logging

```
[timestamp] LEVEL: message
{
  additional: "context"
}
```

## Data Flow Examples

### Example 1: Send Verification Email

```
Client Request
    │
    ▼
POST /email/verification
    │
    ├─ Validate (email, token)
    ├─ Call emailService.sendVerificationEmail()
    │
    ├─ Generate HTML with link
    ├─ Call sendEmail (via nodemailer)
    │
    ├─ Nodemailer connects to Postfix (localhost:25)
    ├─ SMTP protocol exchange
    │
    ├─ Postfix queues email
    ├─ Postfix routes to internet
    │
    ▼
Response to client: {success: true, messageId: "..."}
```

### Example 2: Send with Template

```
Client Request
    │
    ├─ Template: "Welcome {{name}}!"
    ├─ Data: {name: "John"}
    │
    ▼
emailService.sendTemplateEmail()
    │
    ├─ Render template: "Welcome John!"
    ├─ Create HTML with rendered content
    │
    ▼
sendEmail()
    │
    ├─ Call nodemailer
    ├─ Submit to Postfix
    │
    ▼
Response: Success
```

## Configuration Files

### `.env` - Environment Variables

```env
# SMTP
SMTP_HOST=localhost
SMTP_PORT=25
SMTP_SECURE=false
SMTP_IGNORE_TLS=true

# Email
EMAIL_FROM=noreply@yourdomain.com
APP_URL=http://localhost:3000

# Server
PORT=3001
HOST=localhost
NODE_ENV=development

# Logging
LOG_LEVEL=info
```

### `config/services.json` - Service Configuration

```json
{
  "services": [
    {
      "name": "email-sender",
      "enabled": true,
      "command": "node",
      "args": ["build/index.js"],
      "directory": "node/email-sender",
      "autoRestart": true,
      "maxRetries": 5,
      "retryDelay": "5s"
    }
  ]
}
```

### `docker-compose.yml` - Container Services

```yaml
services:
  postfix:     # SMTP server (port 25)
  redis:       # Message queue (port 6379, optional)
```

## Deployment Paths

### Path 1: Docker (Recommended)

```bash
# Start infrastructure
docker-compose up -d

# Install Node dependencies
cd node/email-sender
npm install

# Build
npm run build

# Run with Go bootstrap
cd ../../go/service-bootstrap
go build
./service-bootstrap
```

### Path 2: Direct Installation (Linux)

```bash
# Install Postfix
sudo apt-get install postfix

# Setup Node.js Service
cd node/email-sender
npm install
npm run build

# Run
npm start
```

### Path 3: Development

```bash
# For hot-reload
cd node/email-sender
npm run dev
```

## Scaling Considerations

### Current Design (Single Service)

```
Client → Express API → Nodemailer → Postfix
```

**Pros:**
- Simple
- Low latency
- Easy to understand

**Cons:**
- Limited concurrent sends
- No retry mechanism
- No rate limiting

### Future: With Queue (BullMQ + Redis)

```
Client → Express API → Queue (Redis)
                          ↓
                      Worker Pool
                          ↓
                    Nodemailer (x N)
                          ↓
                       Postfix
```

**Benefits:**
- Handle burst traffic
- Automatic retries
- Rate limiting
- Job persistence
- Multiple workers

### Future: Multiple Email Services

```
Load Balancer
    ├─ Email Service 1
    ├─ Email Service 2
    └─ Email Service 3
         ↓
    Shared Redis Queue
         ↓
    Shared Postfix
```

## Monitoring & Debugging

### Service Health Checks

```bash
# API Health
curl http://localhost:3001/health

# Postfix Queue
mailq

# Email Logs
tail -f /var/log/mail.log

# Service Logs
# (from console/stdin during run)
```

### Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| ECONNREFUSED:25 | Postfix not running | `systemctl start postfix` |
| 503 Service Unavailable | SMTP connection failed | Check Postfix: `systemctl status postfix` |
| Port already in use | Another service using port 3001 | Change PORT in .env |
| Emails not sending | Postfix relay not configured | Check relay settings |

## Security Considerations

### Current

- ✅ Validates all input
- ✅ No plaintext password storage (use env vars)
- ✅ Handles errors gracefully
- ⚠️ No rate limiting
- ⚠️ No authentication on API

### Future Improvements

- [ ] API key authentication
- [ ] Rate limiting per client
- [ ] Encryption for sensitive data
- [ ] Audit logging
- [ ] DKIM/SPF configuration
- [ ] Bounce/complaint handling

## Integration Points

When integrating with your backend:

1. **HTTP Client** - Make POST requests to `/email/*` endpoints
2. **Configuration** - Pass EMAIL_FROM and APP_URL to email service
3. **Error Handling** - Handle failures and retry logic
4. **Logging** - Correlate email service logs with your app

Example integration point:

```typescript
// In your backend
import axios from 'axios';

async function sendWelcomeEmail(email: string, name: string) {
  try {
    const response = await axios.post(
      'http://localhost:3001/email/welcome', 
      { email, name }
    );
    return response.data;
  } catch (error) {
    logger.error('Failed to send welcome email', error);
    throw error;
  }
}
```

## Development Checklist

- [x] Go Service Bootstrap
- [x] Express API Server
- [x] Email Service Layer
- [x] Nodemailer Integration
- [x] Docker Compose
- [x] Environment Configuration
- [x] Logging System
- [ ] Queue System (BullMQ)
- [ ] Email Receiving (IMAP)
- [ ] Advanced Retry Logic
- [ ] Rate Limiting
- [ ] API Authentication
