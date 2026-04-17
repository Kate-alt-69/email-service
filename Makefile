.PHONY: help setup build clean build-npm build-smtp build-email run-smtp run-email dev

help:
	@echo "Email Service Build System"
	@echo ""
	@echo "Available targets:"
	@echo "  make setup              - Install dependencies (Node.js + Go)"
	@echo "  make build              - Build everything (npm + Go binaries)"
	@echo "  make build-npm          - Build TypeScript -> JavaScript"
	@echo "  make build-smtp         - Build SMTP server binary"
	@echo "  make build-email        - Build Email Service binary"
	@echo "  make run-smtp           - Run SMTP server"
	@echo "  make run-email          - Run Email Service"
	@echo "  make dev                - Run in development mode (ts-node)"
	@echo "  make clean              - Clean all build artifacts"
	@echo ""

setup:
	@echo "Checking dependencies..."
	@command -v node >/dev/null 2>&1 || { echo "Node.js not found"; exit 1; }
	@echo "- Node.js: $$(node --version)"
	@command -v npm >/dev/null 2>&1 || { echo "npm not found"; exit 1; }
	@echo "- npm: $$(npm --version)"
	@command -v go >/dev/null 2>&1 || { echo "Go not found"; exit 1; }
	@echo "- Go: $$(go version)"

build: setup build-npm build-smtp build-email
	@echo ""
	@echo "Build Complete"
	@echo ""
	@echo "Binaries in dist/:"
	@ls -lh dist/ 2>/dev/null || echo "  (not found)"
	@echo ""

build-npm: setup
	@echo "Building TypeScript..."
	@cd node/email-sender && npm run build
	@mkdir -p dist
	@cp node/email-sender/build/smtp-server.js dist/
	@cp node/email-sender/build/email-service.js dist/
	@echo "- TypeScript compiled"

build-smtp: build-npm
	@echo "Building SMTP Server binary..."
	@mkdir -p dist
	@cd go/smtp-server && \
		GOOS=windows GOARCH=amd64 go build -o ../../dist/email-smtp.exe . && \
		echo "  - Windows: dist/email-smtp.exe" || true
	@cd go/smtp-server && \
		GOOS=linux GOARCH=amd64 go build -o ../../dist/email-smtp . && \
		echo "  - Linux: dist/email-smtp" || true

build-email: build-smtp
	@echo "Building Email Service binary..."
	@mkdir -p dist
	@cd go/email-service && \
		GOOS=windows GOARCH=amd64 go build -o ../../dist/email-service.exe . && \
		echo "  - Windows: dist/email-service.exe" || true
	@cd go/email-service && \
		GOOS=linux GOARCH=amd64 go build -o ../../dist/email-service . && \
		echo "  - Linux: dist/email-service" || true

run-smtp: build-smtp
	@echo "Starting SMTP Server..."
	@./dist/email-smtp.exe || ./dist/email-smtp

run-email: build-email
	@echo "Starting Email Service..."
	@./dist/email-service.exe || ./dist/email-service

dev: setup
	@echo "Running in development mode..."
	@cd node/email-sender && npm run dev

clean:
	@echo "Cleaning..."
	@rm -rf dist/
	@cd node/email-sender && rm -rf build/ dist/
	@cd go/smtp-server && go clean
	@cd go/email-service && go clean
	@echo "- Clean complete"

.DEFAULT_GOAL := help
