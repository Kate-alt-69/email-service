# Log Hook for Email Service

This is a **simplified log formatter** for the email service. It's NOT an independent service manager.

## Purpose

When the email service runs (via Node.js), this log hook:
1. Captures its log output (stdout/stderr)
2. Formats it with timestamps and service name
3. Outputs cleanly formatted logs

## How It Works

The bootstrap_manager runs this as a log processor:

```
Node.js Email Service
    │ stdout/stderr
    ▼
Log Hook (this executable)
    │ formats logs
    ▼
[HH:MM:SS.mmm] [emailSMTP] actual service log
```

## Usage

The bootstrap_manager handles this automatically. You don't need to run this directly.

However, if you want to use it manually:

```bash
# Build the log hook
go build -o log-hook

# Use it to format logs from a service
your-service | SERVICE_NAME=my-service ./log-hook
```

Example output:
```
[14:25:30.123] [emailSMTP] Server running on http://localhost:3001
[14:25:30.456] [emailSMTP] ✓ SMTP connection verified
[14:25:45.789] [emailSMTP] Processing email from user@example.com
```

## Log Format

```
[HH:MM:SS.mmm] [service-name] <actual service logs>
```

- **HH:MM:SS.mmm** - Current time with milliseconds
- **service-name** - Name of the service (from env var `SERVICE_NAME`)
- **logs** - Actual output from the service

## Environment Variables

- `SERVICE_NAME` - Name to display in logs (default: "unknown-service")

## Integration with Bootstrap Manager

The bootstrap_manager automatically:
1. Sets `SERVICE_NAME` environment variable
2. Pipes service output through this log hook
3. Displays formatted logs

You don't need to do anything!

## Future Enhancements

This could be extended to:
- Send logs to files
- Send to remote logging service
- Filter/transform logs
- Request resources from bootstrap manager
- Report service status back to bootstrap manager

For now, it's a simple but effective log formatter. 🎯
