# Email Service Build System

Build scripts and configuration for compiling TypeScript email services into standalone Go binaries.

## Quick Start

```powershell
# Windows
cd email-service
./build.ps1 build

# Linux/macOS
cd email-service
make build
```

## Files

- **Makefile** - Linux/macOS build system
- **build.ps1** - Windows PowerShell build script
- **go/smtp-server/** - SMTP server wrapper
- **go/email-service/** - Email service API wrapper
- **node/email-sender/** - TypeScript/Node.js source code

## Build Targets

### PowerShell (Windows)

```powershell
./build.ps1 help                    # Show all targets
./build.ps1 setup                   # Check dependencies
./build.ps1 build                   # Build everything
./build.ps1 build-npm               # Compile TypeScript
./build.ps1 build-smtp              # Build SMTP binary
./build.ps1 build-email             # Build Email Service binary
./build.ps1 run-smtp                # Run SMTP server
./build.ps1 run-email               # Run Email Service API
./build.ps1 clean                   # Clean build artifacts
```

### Makefile (Linux/macOS)

```bash
make help                           # Show all targets
make setup                          # Check dependencies
make build                          # Build everything
make build-npm                      # Compile TypeScript
make build-smtp                     # Build SMTP binary
make build-email                    # Build Email Service binary
make run-smtp                       # Run SMTP server
make run-email                      # Run Email Service API
make clean                          # Clean build artifacts
```

## Output

Build artifacts are in `dist/`:

- `email-smtp.exe` / `email-smtp` - SMTP server (Windows/Linux)
- `email-service.exe` / `email-service` - Email API (Windows/Linux)

## Architecture

```
TypeScript Source
    ↓
npm run build (tsc)
    ↓
JavaScript Files (build/)
    ↓
Go Wrappers (read files at runtime)
    ↓
Standalone Binaries (dist/)
```

The Go wrappers:
1. Check dependencies (e.g., email-service checks if email-smtp is running)
2. Locate compiled JavaScript files
3. Launch Node.js runtime with JavaScript code
4. Pass through all output and signals

## Dependencies

- **Node.js** 16+
- **npm** 7+
- **Go** 1.21+

## Configuration

Set environment variables before running:

```bash
export DB_HOST=localhost
export DB_USER=postgres
export DB_PASSWORD=password
export SMTP_HOST=localhost
export SMTP_PORT=25
export EMAIL_FROM=noreply@example.com
```

See `node/email-sender/.env.example` for all available options.

## Service Startup Order

1. Start SMTP server: `./dist/email-smtp.exe`
2. Start Email Service API: `./dist/email-service.exe` (requires SMTP)

The email service will verify SMTP is running before starting.

## Development

For development, use TypeScript directly:

```powershell
./build.ps1 dev
# or
cd node/email-sender && npm run dev
```

This uses ts-node for hot-reload during development.
