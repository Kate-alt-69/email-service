#!/bin/bash
# Email Service Multi-Platform Build Script for Unix/Linux/macOS
# Usage: ./build.sh [target] [filter]
# Generates binaries for bootstrap-manager discovery

set -e

BUILD_DIR="dist"
NPM_DIR="node/email-sender"
SMTP_DIR="go/smtp-server"
EMAIL_DIR="go/email-service"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
NC='\033[0m' # No Color

# Build targets array
declare -a BUILD_TARGETS=(
    # Windows
    "windows:amd64:windows-amd64:.exe:Windows 64-bit"
    "windows:386:windows-386:.exe:Windows 32-bit"
    "windows:arm64:windows-arm64:.exe:Windows ARM 64-bit"
    
    # Linux
    "linux:amd64:linux-amd64::Linux 64-bit"
    "linux:386:linux-386::Linux 32-bit"
    "linux:arm64:linux-arm64::Linux ARM 64-bit"
    "linux:arm:linux-arm::Linux ARM 32-bit"
    
    # macOS
    "darwin:amd64:darwin-amd64::macOS Intel"
    "darwin:arm64:darwin-arm64::macOS Apple Silicon (M1/M2)"
    
    # Other platforms
    "freebsd:amd64:freebsd-amd64::FreeBSD 64-bit"
    "openbsd:amd64:openbsd-amd64::OpenBSD 64-bit"
)

print_help() {
    cat <<EOF
${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}
${CYAN}║     Email Service Multi-Platform Build System                 ║${NC}
${CYAN}║     Generates binaries for bootstrap-manager discovery        ║${NC}
${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}

${YELLOW}Usage: ./build.sh [target] [filter]${NC}

${YELLOW}Available targets:${NC}
  setup                  - Install dependencies (Node.js + Go)
  build                  - Build ALL platforms (npm + binaries)
  build-multi            - Build for all supported platforms (same as build)
  build-bundled          - Build self-contained bundled binaries (esbuild + pkg)
  build-npm              - Build TypeScript to JavaScript
  build-smtp             - Build SMTP binaries for all platforms
  build-email            - Build Email Service for all platforms
  build-smtp-native      - Build SMTP for current OS/ARCH only
  build-email-native     - Build Email Service for current OS/ARCH only
  list-targets           - Show all supported build targets
  clean                  - Clean all build artifacts

${YELLOW}Optional filter (append to target):${NC}
  ./build.sh build-smtp windows     # Build SMTP for Windows only
  ./build.sh build-email linux-amd64 # Build Email Service for Linux 64-bit only

EOF
}

check_setup() {
    echo -e "${YELLOW}Checking dependencies...${NC}"
    
    if ! command -v node &> /dev/null; then
        echo -e "${RED}✗ Node.js NOT found${NC}"
        return 1
    fi
    local node_ver=$(node --version)
    echo -e "${GREEN}✓ Node.js: $node_ver${NC}"
    
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}✗ npm NOT found${NC}"
        return 1
    fi
    local npm_ver=$(npm --version)
    echo -e "${GREEN}✓ npm: $npm_ver${NC}"
    
    if ! command -v go &> /dev/null; then
        echo -e "${RED}✗ Go NOT found${NC}"
        return 1
    fi
    local go_ver=$(go version)
    echo -e "${GREEN}✓ $go_ver${NC}"
    
    return 0
}

build_npm() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}Building TypeScript...${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    
    pushd "$NPM_DIR" > /dev/null
    
    echo -e "${GRAY}Installing dependencies...${NC}"
    if ! npm install 2>&1 | sed 's/^/  /'; then
        popd > /dev/null
        echo -e "${RED}✗ npm install failed${NC}"
        return 1
    fi
    
    echo -e "${GRAY}Compiling TypeScript...${NC}"
    if ! npm run build 2>&1 | sed 's/^/  /'; then
        popd > /dev/null
        echo -e "${RED}✗ npm build failed${NC}"
        return 1
    fi
    
    echo -e "${GRAY}Bundling with esbuild...${NC}"
    
    # Install esbuild locally if not already installed
    if [ ! -f "node_modules/.bin/esbuild" ]; then
        echo -e "${GRAY}  Installing esbuild...${NC}"
        npm install --save-dev esbuild 2>&1 > /dev/null
    fi
    
    # Use local esbuild if available - esbuild runs from npm dir, so build/ is correct
    if [ -f "node_modules/.bin/esbuild" ]; then
        # Bundle SMTP Server - HEAVILY OPTIMIZED: minify, tree-shake, no source maps
        echo -e "${GRAY}  Bundling SMTP Server...${NC}"
        if ./node_modules/.bin/esbuild build/smtp-server.js \
            --bundle \
            --platform=node \
            --target=node18 \
            --minify \
            --tree-shaking=true \
            --outfile=build/smtp-server-bundled.cjs \
            --external:bufferutil \
            --external:utf-8-validate \
            --external:pino-pretty 2>&1 > /dev/null; then
            mv build/smtp-server-bundled.cjs build/smtp-server.js 2>/dev/null
            echo -e "${GREEN}  ✓ SMTP Server bundled (minified + tree-shook)${NC}"
        else
            echo -e "${RED}  ✗ SMTP Server bundling FAILED${NC}"
        fi
        
        # Bundle Email Service - HEAVILY OPTIMIZED: minify, tree-shake, no source maps
        echo -e "${GRAY}  Bundling Email Service...${NC}"
        if ./node_modules/.bin/esbuild build/email-service.js \
            --bundle \
            --platform=node \
            --target=node18 \
            --minify \
            --tree-shaking=true \
            --outfile=build/email-service-bundled.cjs \
            --external:bufferutil \
            --external:utf-8-validate \
            --external:pino-pretty 2>&1 > /dev/null; then
            mv build/email-service-bundled.cjs build/email-service.js 2>/dev/null
            echo -e "${GREEN}  ✓ Email Service bundled (minified + tree-shook)${NC}"
        else
            echo -e "${RED}  ✗ Email Service bundling FAILED${NC}"
        fi
    else
        echo -e "${YELLOW}  ⚠️  esbuild not available, binaries will include unbundled JS${NC}"
    fi
    
    popd > /dev/null
    
    mkdir -p "$BUILD_DIR"
    cp "$NPM_DIR/build/smtp-server.js" "$BUILD_DIR/" 2>/dev/null || true
    cp "$NPM_DIR/build/email-service.js" "$BUILD_DIR/" 2>/dev/null || true
    echo -e "${GREEN}✓ TypeScript compiled and bundled successfully${NC}"
    return 0
}

build_bundled() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}Building Bundled Binaries (esbuild + pkg)${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${GRAY}This creates truly self-contained binaries for all 11 platforms${NC}"
    
    if [ ! -f "build-bundled.js" ]; then
        echo -e "${RED}✗ build-bundled.js not found${NC}"
        return 1
    fi
    
    # First build npm
    if ! build_npm; then
        return 1
    fi
    
    # Install global tools if needed
    echo -e "${GRAY}Checking for esbuild and pkg...${NC}"
    if ! command -v esbuild &> /dev/null || ! command -v pkg &> /dev/null; then
        echo -e "${YELLOW}Installing esbuild and pkg globally...${NC}"
        npm install -g esbuild pkg 2>&1 | sed 's/^/  /'
        if [ $? -ne 0 ]; then
            echo -e "${RED}✗ Failed to install build tools${NC}"
            return 1
        fi
    fi
    
    # Run bundled build
    echo -e "${YELLOW}Running bundled build orchestrator...${NC}"
    if ! node build-bundled.js 2>&1 | sed 's/^/  /'; then
        echo -e "${RED}✗ Bundled build failed${NC}"
        return 1
    fi
    
    echo ""
    echo -e "${GREEN}✓ Bundled binaries created successfully${NC}"
    echo -e "${GREEN}  Location: back-end/service-bin/email_service/${NC}"
    return 0
}

build_service() {
    local service_dir="$1"
    local service_name="$2"
    local target_count="$3"
    local filter="$4"
    
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}Building $service_name for $target_count platform(s)...${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    
    mkdir -p "$BUILD_DIR"
    
    local success_count=0
    local fail_count=0
    
    pushd "$service_dir" > /dev/null
    
    for target in "${BUILD_TARGETS[@]}"; do
        IFS=':' read -r os arch suffix ext display_name <<< "$target"
        
        # Skip if filter is specified and doesn't match
        if [[ -n "$filter" ]] && [[ ! "$suffix" =~ "$filter" ]] && [[ ! "$os" =~ "$filter" ]]; then
            continue
        fi
        
        local target_name="${service_name}-${suffix}${ext}"
        local output_path="../../${BUILD_DIR}/${target_name}"
        
        echo -ne "  Building: ${display_name}... "
        
        if GOOS="$os" GOARCH="$arch" go build -o "$output_path" . 2>/dev/null; then
            local file_size=$(du -h "$output_path" | cut -f1)
            echo -e "${GREEN}✓ ($file_size)${NC}"
            ((success_count++))
        else
            echo -e "${RED}✗ FAILED${NC}"
            ((fail_count++))
        fi
    done
    
    popd > /dev/null
    
    echo ""
    if [[ $fail_count -eq 0 ]]; then
        echo -e "${GREEN}  Summary: $success_count succeeded, $fail_count failed${NC}"
    else
        echo -e "${YELLOW}  Summary: $success_count succeeded, $fail_count failed${NC}"
    fi
    
    [[ $fail_count -eq 0 ]]
}

list_targets() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}Available Build Targets${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    local last_os=""
    for target in "${BUILD_TARGETS[@]}"; do
        IFS=':' read -r os arch suffix ext display_name <<< "$target"
        
        if [[ "$os" != "$last_os" ]]; then
            if [[ -n "$last_os" ]]; then
                echo ""
            fi
            echo -e "${CYAN}${os^^}:${NC}"
            last_os="$os"
        fi
        
        local binary_name="service-${suffix}${ext}"
        echo -e "  ${GREEN}•${NC} ${display_name} (${suffix})"
        echo -e "    ${GRAY}└─ Binary name: ${binary_name}${NC}"
    done
    echo ""
}

organize_build_output() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}Organizing build output...${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    
    # Create directory structure
    mkdir -p "$BUILD_DIR/config"
    mkdir -p "$BUILD_DIR/config/assets"
    mkdir -p "$BUILD_DIR/config/certs"
    mkdir -p "$BUILD_DIR/dep"
    
    echo -e "${GREEN}✓ Created: dist/config${NC}"
    echo -e "${GREEN}✓ Created: dist/dep${NC}"
    
    # Copy configuration file
    if [[ -f "config/email_service.yml" ]]; then
        cp "config/email_service.yml" "$BUILD_DIR/config/"
        echo -e "${GREEN}✓ Copied: email_service.yml → config/${NC}"
    fi    
    # Copy .env file if it exists
    if [[ -f ".env" ]]; then
        cp ".env" "$BUILD_DIR/"
        echo -e "${GREEN}✓ Copied: .env → dist/${NC}"
    else
        echo -e "${YELLOW}⚠ Warning: .env file not found at repository root${NC}"
    fi    
    # Copy JS runtime files
    for jsfile in "$BUILD_DIR/smtp-server.js" "$BUILD_DIR/email-service.js"; do
        if [[ -f "$jsfile" ]]; then
            cp "$jsfile" "$BUILD_DIR/dep/"
            filename=$(basename "$jsfile")
            echo -e "${GREEN}✓ Copied: $filename → dep/${NC}"
        fi
    done
    
    # NOTE: node_modules is NOT copied because:
    # - Bundled binaries (esbuild + pkg) have dependencies compiled in
    # - No runtime dependency on node_modules needed
    # - Each binary is standalone and portable
    # - Saves ~50MB+ of disk space per deployment
    
    # Copy assets if they exist
    if [[ -d "assets" ]]; then
        echo -e "${GRAY}Copying assets...${NC}"
        cp -r assets/* "$BUILD_DIR/config/assets/" 2>/dev/null || true
        echo -e "${GREEN}✓ Copied assets${NC}"
    fi
    
    echo ""
    echo -e "${GREEN}Build output organized:${NC}"
    echo -e "${CYAN}  dist/${NC}"
    echo -e "${CYAN}    ├── .env${NC}"
    echo -e "${CYAN}    ├── config/${NC}"
    echo -e "${CYAN}    │   ├── email_service.yml${NC}"
    echo -e "${CYAN}    │   ├── assets/${NC}"
    echo -e "${CYAN}    │   └── certs/${NC}"
    echo -e "${CYAN}    ├── dep/${NC}"
    echo -e "${CYAN}    │   ├── smtp-server.js${NC}"
    echo -e "${CYAN}    │   └── email-service.js${NC}"
    echo -e "${CYAN}    ├── email-service-*${NC}"
    echo -e "${CYAN}    ├── email-smtp-*${NC}"
    echo -e "${CYAN}    └── [other platform binaries]${NC}"
}

clean_build() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}Cleaning build artifacts...${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    
    if [[ -d "$BUILD_DIR" ]]; then
        rm -rf "$BUILD_DIR"
        echo -e "${GREEN}✓ Removed dist/${NC}"
    fi
    if [[ -d "$NPM_DIR/build" ]]; then
        rm -rf "$NPM_DIR/build"
        echo -e "${GREEN}✓ Removed npm build/${NC}"
    fi
    if [[ -d "$NPM_DIR/dist" ]]; then
        rm -rf "$NPM_DIR/dist"
        echo -e "${GREEN}✓ Removed npm dist/${NC}"
    fi
    
    pushd "$SMTP_DIR" > /dev/null
    go clean 2>/dev/null || true
    popd > /dev/null
    
    pushd "$EMAIL_DIR" > /dev/null
    go clean 2>/dev/null || true
    popd > /dev/null
    
    echo -e "${GREEN}✓ Go modules cleaned${NC}"
    echo -e "${GREEN}✓ Clean complete${NC}"
}

show_build_results() {
    echo ""
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}Build Results${NC}"
    echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    if [[ -d "$BUILD_DIR" ]]; then
        if ls -A "$BUILD_DIR" > /dev/null 2>&1; then
            echo -e "${GREEN}Generated binaries:${NC}"
            echo ""
            
            # Group by service name
            for file in "$BUILD_DIR"/*; do
                if [[ -f "$file" ]]; then
                    local basename=$(basename "$file")
                    local service=$(echo "$basename" | sed 's/^\([^-]*\)-.*/\1/')
                    local size=$(du -h "$file" | cut -f1)
                    echo -e "  ${CYAN}•${NC} ${GREEN}$basename${NC}"
                    echo -e "    ${GRAY}└─ Size: $size${NC}"
                fi
            done
            echo ""
        else
            echo -e "${YELLOW}No binaries found in dist/${NC}"
        fi
    else
        echo -e "${YELLOW}Build directory not found${NC}"
    fi
    echo ""
}

main() {
    local target="${1:-help}"
    local filter="${2:-}"
    
    case "${target,,}" in
        help)
            print_help
            ;;
        setup)
            if check_setup; then
                echo ""
                echo -e "${GREEN}✓ All dependencies are installed${NC}"
            fi
            ;;
        build-npm)
            if check_setup; then
                build_npm
            fi
            ;;
        list-targets)
            list_targets
            ;;
        build-smtp-native)
            if check_setup; then
                build_npm
                [[ -n "$filter" ]] && echo -e "${YELLOW}Filter parameter ignored for native builds${NC}"
                build_service "$SMTP_DIR" "email-smtp" 1 ""
                show_build_results
            fi
            ;;
        build-email-native)
            if check_setup; then
                build_npm
                [[ -n "$filter" ]] && echo -e "${YELLOW}Filter parameter ignored for native builds${NC}"
                build_service "$EMAIL_DIR" "email-service" 1 ""
                show_build_results
            fi
            ;;
        build-smtp)
            if check_setup; then
                build_npm
                local target_count=${#BUILD_TARGETS[@]}
                build_service "$SMTP_DIR" "email-smtp" "$target_count" "$filter"
                show_build_results
                organize_build_output
            fi
            ;;
        build-email)
            if check_setup; then
                build_npm
                local target_count=${#BUILD_TARGETS[@]}
                build_service "$EMAIL_DIR" "email-service" "$target_count" "$filter"
                show_build_results
                organize_build_output
            fi
            ;;
        build|build-multi)
            if check_setup; then
                build_npm
                local target_count=${#BUILD_TARGETS[@]}
                build_service "$SMTP_DIR" "email-smtp" "$target_count" "$filter"
                build_service "$EMAIL_DIR" "email-service" "$target_count" "$filter"
                show_build_results
                organize_build_output
                echo -e "${GREEN}✓ All builds complete!${NC}"
            fi
            ;;        build-bundled)
            if check_setup; then
                build_bundled
            fi
            ;;        clean)
            clean_build
            ;;
        *)
            echo -e "${RED}Unknown target: $target${NC}"
            echo ""
            print_help
            exit 1
            ;;
    esac
}

main "$@"

