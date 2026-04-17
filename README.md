# Email Service

`email-service` is the Node/SMTP mail worker used by the backend ecosystem.

It now supports:

- outbound mail through a normal SMTP relay, including SendPulse
- inbound/local SMTP acceptance and storage
- a file-backed mail database for external readers
- a 12-hour `.db.lock` recovery journal with atomic snapshot writes

## Current shape

Outbound flow:

`your app -> email-service HTTP API -> Nodemailer -> SendPulse SMTP relay -> internet`

Local inbound flow:

`SMTP client -> email-service SMTP listener -> parser -> file DB`

Storage flow:

`write operation -> email-service.db.lock journal -> atomic email-service.db snapshot`

## SendPulse relay

The service does not need special SendPulse SDK code. It uses standard SMTP.

Supported env aliases:

```env
EMAIL_PROVIDER=sendpulse
EMAIL_RELAY_PROVIDER=sendpulse

SENDPULSE_SMTP_HOST=smtp-pulse.com
SENDPULSE_SMTP_PORT=2525
# alt ports: 465 (SSL) or 587 (TLS)
SENDPULSE_SMTP_SECURE=false
SENDPULSE_SMTP_IGNORE_TLS=false
SENDPULSE_SMTP_USER=
SENDPULSE_SMTP_PASSWORD=
```

You can still override with generic relay vars:

```env
SMTP_RELAY_HOST=
SMTP_RELAY_PORT=
SMTP_RELAY_SECURE=
SMTP_RELAY_IGNORE_TLS=
SMTP_RELAY_USER=
SMTP_RELAY_PASSWORD=
```

Resolution order is:

1. `SMTP_RELAY_*`
2. `SMTP_*`
3. SendPulse profile when `EMAIL_PROVIDER=sendpulse` or `SENDPULSE_SMTP_*` is present

## Storage backend

Default storage backend:

```env
EMAIL_STORAGE_DRIVER=file
EMAIL_DB_PATH=./data/email-service.db
```

Optional legacy backend:

```env
EMAIL_STORAGE_DRIVER=postgres
```

### Snapshot file

`email-service.db` is a plain JSON file intended to be readable by external apps without a live DB connection.

Top-level shape:

```json
{
  "version": 1,
  "updated_at": "2026-04-16T12:00:00.000Z",
  "emails": [],
  "attachments": [],
  "logs": [],
  "threads": []
}
```

### Lock journal

`email-service.db.lock` is also JSON. It stores the last 12 hours of write operations.

Write behavior:

1. operation is added to `.db.lock`
2. in-memory snapshot is updated
3. `.db` is rewritten atomically using temp-file rename

Boot behavior:

1. service loads `.db`
2. service loads `.db.lock`
3. recent journal operations are replayed into the snapshot
4. recovery is logged clearly
5. `.db` is rewritten with the recovered state

This is not an OS-level file lock. It is a recovery journal.

## Data model

### Emails

Each entry in `emails` looks like:

```json
{
  "id": "uuid",
  "message_id": "<message@example.net>",
  "from_address": "sender@example.net",
  "to_addresses": ["user@example.com"],
  "subject": "Hello",
  "html_body": "<h1>Hello</h1>",
  "text_body": "Hello",
  "email_type": "transactional",
  "status": "sent",
  "direction": "outbound",
  "created_at": "2026-04-16T12:00:00.000Z",
  "updated_at": "2026-04-16T12:00:01.000Z",
  "metadata": {
    "in_reply_to": null,
    "references": []
  },
  "error_message": null
}
```

Fields:

- `status`: `pending | processing | sent | failed | received`
- `direction`: `outbound | inbound`
- `metadata`: provider-specific or parser-specific details

### Attachments

Each entry in `attachments` looks like:

```json
{
  "id": "uuid",
  "email_id": "uuid",
  "filename": "invoice.pdf",
  "content_type": "application/pdf",
  "size": 12345,
  "data_base64": "JVBERi0xLjQK...",
  "created_at": "2026-04-16T12:00:00.000Z"
}
```

Attachments are linked by `email_id`.

### Logs

Each entry in `logs` looks like:

```json
{
  "id": "uuid",
  "email_id": "uuid",
  "event": "received",
  "details": "Email received from sender@example.net",
  "created_at": "2026-04-16T12:00:00.000Z"
}
```

### Threads

`threads` is a derived view for external apps. It is rebuilt from stored emails whenever the snapshot changes.

Thread shape:

```json
{
  "id": "<root-message-or-thread-id>",
  "subject": "Hello",
  "email_ids": ["uuid-1", "uuid-2"],
  "participant_addresses": [
    "sender@example.net",
    "user@example.com"
  ],
  "latest_email_id": "uuid-2",
  "created_at": "2026-04-16T12:00:00.000Z",
  "updated_at": "2026-04-16T12:15:00.000Z"
}
```

Thread resolution order:

1. `metadata.thread_id`
2. `metadata.in_reply_to`
3. last `metadata.references` entry
4. current `message_id`

## API

Standalone API server:

- `GET /health`
- `POST /api/send`
- `GET /api/emails/:emailId`
- `GET /api/emails?status=sent&limit=50`
- `GET /api/emails/by-address/:address?limit=50&offset=0`
- `POST /service/request`

Unified service:

- `GET /health`
- `POST /send`
- `GET /email/:id`
- `GET /emails?status=received&limit=50`
- `GET /emails/by-address/:address?limit=50&offset=0`
- `POST /service/request`

## Minimal config

Example `.env` for SendPulse:

```env
PORT=3430
HOST=127.0.0.1
NODE_ENV=production

EMAIL_STORAGE_DRIVER=file
EMAIL_DB_PATH=./data/email-service.db

EMAIL_PROVIDER=sendpulse
SENDPULSE_SMTP_HOST=smtp-pulse.com
SENDPULSE_SMTP_PORT=2525
SENDPULSE_SMTP_SECURE=false
SENDPULSE_SMTP_IGNORE_TLS=false
SENDPULSE_SMTP_USER=your-login
SENDPULSE_SMTP_PASSWORD=your-password

EMAIL_FROM=noreply@httpsbuffcowland.in
EMAIL_DOMAINS=httpsbuffcowland.in

SMTP_SERVER_PORT=3425
SMTP_AUTH_REQUIRED=false
```

## Run

```bash
cd email-service/node/email-sender
npm install
npm run build
npm run start:unified
```

## Notes

- Cloudflare Tunnel is not required for the SendPulse sending path.
- Public inbound mail from the internet is still a separate problem from outbound relay.
- The file DB is designed for readability and recovery, not for very high write throughput.
