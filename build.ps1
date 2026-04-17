#!/usr/bin/env pwsh
# Email Service Multi-Platform Build Script
# Usage: ./build.ps1 [target] [filter]
# Supports cross-compilation for Windows, Linux, macOS, and other platforms
# Binaries are named for bootstrap-manager discovery: service-name-OS-ARCH[.exe]

param(
    [string]$Target = "help",
    [string]$Filter = ""  # Optional filter for specific OS/ARCH
)

$BuildDir = "dist"
$NPMDir = "node/email-sender"
$SMTPDir = "go/smtp-server"
$EmailDir = "go/email-service"

# Define all supported build targets for cross-compilation
# Format: @{ OS = "goos"; Arch = "goarch"; Suffix = "filename-suffix"; Ext = ".exe or empty" }
$BuildTargets = @(
    # Windows
    @{ OS = "windows"; Arch = "amd64"; Suffix = "windows-amd64"; Ext = ".exe"; DisplayName = "Windows 64-bit" },
    @{ OS = "windows"; Arch = "386"; Suffix = "windows-386"; Ext = ".exe"; DisplayName = "Windows 32-bit" },
    @{ OS = "windows"; Arch = "arm64"; Suffix = "windows-arm64"; Ext = ".exe"; DisplayName = "Windows ARM 64-bit" },
    
    # Linux
    @{ OS = "linux"; Arch = "amd64"; Suffix = "linux-amd64"; Ext = ""; DisplayName = "Linux 64-bit" },
    @{ OS = "linux"; Arch = "386"; Suffix = "linux-386"; Ext = ""; DisplayName = "Linux 32-bit" },
    @{ OS = "linux"; Arch = "arm64"; Suffix = "linux-arm64"; Ext = ""; DisplayName = "Linux ARM 64-bit" },
    @{ OS = "linux"; Arch = "arm"; Suffix = "linux-arm"; Ext = ""; DisplayName = "Linux ARM 32-bit" },
    
    # macOS
    @{ OS = "darwin"; Arch = "amd64"; Suffix = "darwin-amd64"; Ext = ""; DisplayName = "macOS Intel" },
    @{ OS = "darwin"; Arch = "arm64"; Suffix = "darwin-arm64"; Ext = ""; DisplayName = "macOS Apple Silicon (M1/M2)" },
    
    # Other platforms
    @{ OS = "freebsd"; Arch = "amd64"; Suffix = "freebsd-amd64"; Ext = ""; DisplayName = "FreeBSD 64-bit" },
    @{ OS = "openbsd"; Arch = "amd64"; Suffix = "openbsd-amd64"; Ext = ""; DisplayName = "OpenBSD 64-bit" }
)

function Print-Help {
    Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║     Email Service Multi-Platform Build System                 ║" -ForegroundColor Cyan
    Write-Host "║     Generates binaries for bootstrap-manager discovery        ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Usage: ./build.ps1 [target] [filter]" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Available targets:" -ForegroundColor Yellow
    Write-Host "  setup                  - Install dependencies (Node.js + Go)" -ForegroundColor Green
    Write-Host "  build                  - Build ALL platforms (npm + binaries)" -ForegroundColor Green
    Write-Host "  build-multi            - Build for all supported platforms (same as build)" -ForegroundColor Green
    Write-Host "  build-bundled          - Build self-contained bundled binaries (esbuild + pkg)" -ForegroundColor Green
    Write-Host "  build-npm              - Build TypeScript to JavaScript" -ForegroundColor Green
    Write-Host "  build-smtp             - Build SMTP binaries for all platforms" -ForegroundColor Green
    Write-Host "  build-email            - Build Email Service for all platforms" -ForegroundColor Green
    Write-Host "  build-smtp-native      - Build SMTP for current OS/ARCH only" -ForegroundColor Green
    Write-Host "  build-email-native     - Build Email Service for current OS/ARCH only" -ForegroundColor Green
    Write-Host "  list-targets           - Show all supported build targets" -ForegroundColor Green
    Write-Host "  clean                  - Clean all build artifacts" -ForegroundColor Green
    Write-Host ""
    Write-Host "Optional filter (append to target):" -ForegroundColor Yellow
    Write-Host "  ./build.ps1 build-smtp windows     # Build SMTP for Windows only" -ForegroundColor Cyan
    Write-Host "  ./build.ps1 build-email linux-amd64 # Build Email Service for Linux 64-bit only" -ForegroundColor Cyan
    Write-Host ""
}

function Check-Setup {
    Write-Host "Checking dependencies..." -ForegroundColor Yellow
    
    $hasNode = $null -ne (Get-Command node -ErrorAction SilentlyContinue)
    $hasNpm = $null -ne (Get-Command npm -ErrorAction SilentlyContinue)
    $hasGo = $null -ne (Get-Command go -ErrorAction SilentlyContinue)
    
    if (!$hasNode) {
        Write-Host "✗ Node.js NOT found" -ForegroundColor Red
        return $false
    }
    $NodeVer = & node --version
    Write-Host "✓ Node.js: $NodeVer" -ForegroundColor Green
    
    if (!$hasNpm) {
        Write-Host "✗ npm NOT found" -ForegroundColor Red
        return $false
    }
    $NpmVer = & npm --version
    Write-Host "✓ npm: $NpmVer" -ForegroundColor Green
    
    if (!$hasGo) {
        Write-Host "✗ Go NOT found" -ForegroundColor Red
        return $false
    }
    $GoVer = & go version
    Write-Host "✓ $GoVer" -ForegroundColor Green
    
    return $true
}

function Check-GoWrappers {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "Validating Go wrappers..." -ForegroundColor Yellow
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    
    $hasErrors = $false
    
    # Check SMTP Server wrapper
    Write-Host "  Checking SMTP Server wrapper..." -ForegroundColor Gray
    Push-Location $SMTPDir
    $output = & go build -o /tmp/test-smtp.exe . 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ✗ SMTP Server Go wrapper has errors:" -ForegroundColor Red
        $output | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        $hasErrors = $true
    } else {
        Write-Host "  ✓ SMTP Server wrapper OK" -ForegroundColor Green
    }
    Pop-Location
    
    # Check Email Service wrapper
    Write-Host "  Checking Email Service wrapper..." -ForegroundColor Gray
    Push-Location $EmailDir
    $output = & go build -o /tmp/test-email.exe . 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ✗ Email Service Go wrapper has errors:" -ForegroundColor Red
        $output | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        $hasErrors = $true
    } else {
        Write-Host "  ✓ Email Service wrapper OK" -ForegroundColor Green
    }
    Pop-Location
    
    if ($hasErrors) {
        Write-Host ""
        Write-Host "Fix the Go wrapper errors above before rebuilding" -ForegroundColor Red
        return $false
    }
    
    Write-Host ""
    return $true
}

function Build-NPM {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "Building TypeScript..." -ForegroundColor Yellow
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    
    Push-Location $NPMDir
    
    Write-Host "  Installing dependencies..." -ForegroundColor Gray
    & npm install 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ✗ npm install failed" -ForegroundColor Red
        Pop-Location
        return $false
    }
    
    Write-Host "  Compiling TypeScript..." -ForegroundColor Gray
    & npm run build 2>&1 | ForEach-Object { Write-Host "    $_" }
    $npmResult = $LASTEXITCODE
    
    if ($npmResult -ne 0) {
        Write-Host "✗ npm build failed" -ForegroundColor Red
        Pop-Location
        return $false
    }
    
    Write-Host "  Bundling with esbuild..." -ForegroundColor Gray
    
    # Install esbuild locally if not already installed
    if (!(Test-Path "node_modules/.bin/esbuild")) {
        Write-Host "    Installing esbuild..." -ForegroundColor Gray
        & npm install --save-dev esbuild 2>&1 | Out-Null
    }
    
    # Use local esbuild if available - esbuild runs from npm dir, so build/ is correct
    $esbuildPath = "node_modules\.bin\esbuild"
    if (Test-Path $esbuildPath) {
        # Bundle SMTP Server - HEAVILY OPTIMIZED: minify, tree-shake, no source maps
        Write-Host "    Bundling SMTP Server..." -ForegroundColor Gray
        $output = & $esbuildPath build/smtp-server.js `
            --bundle `
            --platform=node `
            --target=node18 `
            --minify `
            --tree-shaking=true `
            --outfile=build/smtp-server-bundled.cjs `
            --external:bufferutil `
            --external:utf-8-validate `
            --external:pino-pretty 2>&1
        if ($LASTEXITCODE -eq 0) {
            Move-Item build/smtp-server-bundled.cjs build/smtp-server.js -Force 2>$null
            $bundledSize = (Get-Item "build/smtp-server.js").Length / 1KB
            Write-Host "    ✓ SMTP Server bundled ($('{0:N0}' -f $bundledSize) KB, minified + tree-shook)" -ForegroundColor Green
        } else {
            Write-Host "    ✗ SMTP Server bundling FAILED:" -ForegroundColor Red
            $output | ForEach-Object { Write-Host "      $_" -ForegroundColor Red }
        }
        
        # Bundle Email Service - HEAVILY OPTIMIZED: minify, tree-shake, no source maps
        Write-Host "    Bundling Email Service..." -ForegroundColor Gray
        $output = & $esbuildPath build/email-service.js `
            --bundle `
            --platform=node `
            --target=node18 `
            --minify `
            --tree-shaking=true `
            --outfile=build/email-service-bundled.cjs `
            --external:bufferutil `
            --external:utf-8-validate `
            --external:pino-pretty 2>&1
        if ($LASTEXITCODE -eq 0) {
            Move-Item build/email-service-bundled.cjs build/email-service.js -Force 2>$null
            $bundledSize = (Get-Item "build/email-service.js").Length / 1KB
            Write-Host "    ✓ Email Service bundled ($('{0:N0}' -f $bundledSize) KB, minified + tree-shook)" -ForegroundColor Green
        } else {
            Write-Host "    ✗ Email Service bundling FAILED:" -ForegroundColor Red
            $output | ForEach-Object { Write-Host "      $_" -ForegroundColor Red }
        }
    } else {
        Write-Host "    ⚠️  esbuild not available, binaries will include unbundled JS" -ForegroundColor Yellow
    }
    
    Pop-Location
    
    # Now copy from email-sender/build to dist/ for binary building
    if (!(Test-Path $BuildDir)) {
        New-Item -ItemType Directory -Path $BuildDir | Out-Null
    }
    
    Copy-Item "$NPMDir/build/smtp-server.js" "$BuildDir/" -Force 2>$null
    Copy-Item "$NPMDir/build/email-service.js" "$BuildDir/" -Force 2>$null
    Write-Host "✓ TypeScript compiled and bundled successfully" -ForegroundColor Green
    return $true
}

function Build-Service {
    param(
        [string]$ServiceDir,
        [string]$ServiceName,
        [int]$TargetCount = 0
    )
    
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "Building $ServiceName for $TargetCount platform(s)..." -ForegroundColor Yellow
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    
    if (!(Test-Path $BuildDir)) {
        New-Item -ItemType Directory -Path $BuildDir | Out-Null
    }
    
    $successCount = 0
    $failCount = 0
    
    Push-Location $ServiceDir
    
    foreach ($target in $BuildTargets) {
        # Skip if filter is specified and doesn't match
        if ($Filter -and -not ($target.Suffix -like "*$Filter*" -or $target.OS -like "*$Filter*")) {
            continue
        }
        
        $targetName = "$ServiceName-$($target.Suffix)$($target.Ext)"
        $outputPath = "../../dist/$targetName"
        
        # Set environment variables for cross-compilation
        $env:GOOS = $target.OS
        $env:GOARCH = $target.Arch
        
        Write-Host "  Building: $($target.DisplayName)..." -ForegroundColor Gray -NoNewline
        
        $buildOutput = & go build -o "$outputPath" . 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            $fileSize = (Get-Item $outputPath).Length / 1KB
            Write-Host " ✓ ($('{0:N0}' -f $fileSize) KB)" -ForegroundColor Green
            $successCount++
        } else {
            Write-Host " ✗ FAILED" -ForegroundColor Red
            Write-Host "    Error: $buildOutput" -ForegroundColor Red
            $failCount++
        }
        
        # Clear environment variables
        Remove-Item env:GOOS -ErrorAction SilentlyContinue
        Remove-Item env:GOARCH -ErrorAction SilentlyContinue
    }
    
    Pop-Location
    
    Write-Host ""
    Write-Host "  Summary: $successCount succeeded, $failCount failed" -ForegroundColor $(if ($failCount -eq 0) { "Green" } else { "Yellow" })
    
    return ($failCount -eq 0)
}

function Build-BundledBinaries {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "Building Bundled Binaries (esbuild + pkg)" -ForegroundColor Yellow
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "This creates truly self-contained binaries for all 11 platforms" -ForegroundColor Gray
    Write-Host ""
    
    if (!(Test-Path "build-bundled.js")) {
        Write-Host "✗ build-bundled.js not found" -ForegroundColor Red
        return $false
    }
    
    # First build npm
    if (!(Build-NPM)) {
        return $false
    }
    
    # Install global tools if needed
    Write-Host "Checking for esbuild and pkg..." -ForegroundColor Gray
    $hasEsbuild = $null -ne (Get-Command esbuild -ErrorAction SilentlyContinue)
    $hasPkg = $null -ne (Get-Command pkg -ErrorAction SilentlyContinue)
    
    if (!$hasEsbuild -or !$hasPkg) {
        Write-Host "Installing esbuild and pkg globally..." -ForegroundColor Yellow
        & npm install -g esbuild pkg 2>&1 | ForEach-Object { Write-Host "  $_" }
        if ($LASTEXITCODE -ne 0) {
            Write-Host "✗ Failed to install build tools" -ForegroundColor Red
            return $false
        }
    }
    
    # Run bundled build
    Write-Host "Running bundled build orchestrator..." -ForegroundColor Yellow
    & node build-bundled.js 2>&1 | ForEach-Object { Write-Host "  $_" }
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "" 
        Write-Host "✓ Bundled binaries created successfully" -ForegroundColor Green
        Write-Host "  Location: back-end/service-bin/email_service/" -ForegroundColor Green
        return $true
    } else {
        Write-Host "✗ Bundled build failed" -ForegroundColor Red
        return $false
    }
}

function List-Targets {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "Available Build Targets" -ForegroundColor Yellow
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
    
    $groupedTargets = $BuildTargets | Group-Object -Property OS
    
    foreach ($group in $groupedTargets) {
        Write-Host "$($group.Name.ToUpper()):" -ForegroundColor Cyan
        foreach ($target in $group.Group) {
            $binaryName = "service-$($target.Suffix)$($target.Ext)"
            Write-Host "  • $($target.DisplayName) ($($target.Suffix))" -ForegroundColor Green
            Write-Host "    └─ Binary name: $binaryName" -ForegroundColor Gray
        }
        Write-Host ""
    }
}

function Organize-BuildOutput {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "Organizing build output..." -ForegroundColor Yellow
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    
    # Create directory structure
    $ConfigDir = "dist/config"
    $DepDir = "dist/dep"
    $AssetsDir = "$ConfigDir/assets"
    $CertsDir = "$ConfigDir/certs"
    
    $dirs = @($ConfigDir, $DepDir, $AssetsDir, $CertsDir)
    foreach ($dir in $dirs) {
        if (!(Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            Write-Host "✓ Created: $dir" -ForegroundColor Green
        }
    }
    
    # Copy configuration file
    if (Test-Path "config/email_service.yml") {
        Copy-Item "config/email_service.yml" "$ConfigDir/" -Force
        Write-Host "✓ Copied: email_service.yml → config/" -ForegroundColor Green
    }
    
    # Copy .env file if it exists
    if (Test-Path ".env") {
        Copy-Item ".env" "dist/" -Force
        Write-Host "✓ Copied: .env → dist/" -ForegroundColor Green
    } else {
        Write-Host "⚠ Warning: .env file not found at repository root" -ForegroundColor Yellow
    }
    
    # Copy JS runtime files (smtp-server.js, email-service.js)
    $jsFiles = @(
        "dist/smtp-server.js",
        "dist/email-service.js"
    )
    foreach ($jsFile in $jsFiles) {
        if (Test-Path $jsFile) {
            Copy-Item $jsFile "$DepDir/" -Force
            $fileName = Split-Path -Leaf $jsFile
            Write-Host "✓ Copied: $fileName → dep/" -ForegroundColor Green
        }
    }
    
    # NOTE: node_modules is NOT copied because:
    # - Bundled binaries (esbuild + pkg) have dependencies compiled in
    # - No runtime dependency on node_modules needed
    # - Each binary is standalone and portable
    # - Saves ~50MB+ of disk space per deployment
    
    Write-Host ""
    Write-Host "Build output organized:" -ForegroundColor Green
    Write-Host "  dist/" -ForegroundColor Cyan
    Write-Host "    ├── .env" -ForegroundColor Cyan
    Write-Host "    ├── config/" -ForegroundColor Cyan
    Write-Host "    │   ├── email_service.yml" -ForegroundColor Cyan
    Write-Host "    │   ├── assets/" -ForegroundColor Cyan
    Write-Host "    │   └── certs/" -ForegroundColor Cyan
    Write-Host "    ├── dep/" -ForegroundColor Cyan
    Write-Host "    │   ├── smtp-server.js" -ForegroundColor Cyan
    Write-Host "    │   └── email-service.js" -ForegroundColor Cyan
    Write-Host "    ├── email-service-*.exe" -ForegroundColor Cyan
    Write-Host "    ├── email-smtp-*.exe" -ForegroundColor Cyan
    Write-Host "    └── [other platform binaries]" -ForegroundColor Cyan
}

function Clean-Build {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "Cleaning build artifacts..." -ForegroundColor Yellow
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    
    if (Test-Path $BuildDir) {
        Remove-Item -Recurse -Force $BuildDir
        Write-Host "✓ Removed dist/" -ForegroundColor Green
    }
    if (Test-Path "$NPMDir/build") {
        Remove-Item -Recurse -Force "$NPMDir/build"
        Write-Host "✓ Removed npm build/" -ForegroundColor Green
    }
    if (Test-Path "$NPMDir/dist") {
        Remove-Item -Recurse -Force "$NPMDir/dist"
        Write-Host "✓ Removed npm dist/" -ForegroundColor Green
    }
    
    Push-Location $SMTPDir
    & go clean 2>&1 | Out-Null
    Pop-Location
    
    Push-Location $EmailDir
    & go clean 2>&1 | Out-Null
    Pop-Location
    
    Write-Host "✓ Go modules cleaned" -ForegroundColor Green
    Write-Host "✓ Clean complete" -ForegroundColor Green
}

function Build-BundledBinaries {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "Building Self-Contained Bundled Binaries" -ForegroundColor Yellow
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "Using esbuild bundling + pkg for all platforms" -ForegroundColor Gray
    Write-Host ""
    
    # Check if Node.js is installed
    $hasNode = $null -ne (Get-Command node -ErrorAction SilentlyContinue)
    if (!$hasNode) {
        Write-Host "✗ Node.js NOT found - required for bundled builds" -ForegroundColor Red
        return $false
    }
    
    # Check if build-bundled.js exists
    if (!(Test-Path "build-bundled.js")) {
        Write-Host "✗ build-bundled.js not found" -ForegroundColor Red
        return $false
    }
    
    # Run the bundled build orchestrator
    Write-Host "Starting bundled build process..." -ForegroundColor Yellow
    & node build-bundled.js
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✓ Bundled build completed successfully" -ForegroundColor Green
        return $true
    } else {
        Write-Host ""
        Write-Host "✗ Bundled build failed" -ForegroundColor Red
        return $false
    }
}

function Show-BuildResults {
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "Build Results" -ForegroundColor Yellow
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
    
    if (Test-Path $BuildDir) {
        $binaries = Get-ChildItem $BuildDir -File | Sort-Object Name
        
        if ($binaries) {
            Write-Host "Generated binaries:" -ForegroundColor Green
            Write-Host ""
            
            # Group by service name
            $grouped = $binaries | Group-Object { $_.Name -replace '^([^-]*)-.*', '$1' }
            
            foreach ($group in $grouped) {
                Write-Host "  $($group.Name):" -ForegroundColor Cyan
                foreach ($file in $group.Group) {
                    $size = $file.Length / 1KB
                    $platform = $file.Name -replace '^.*-([a-z]*-[a-z0-9]*(?:\.[a-z]+)?)$', '$1'
                    Write-Host "    • $($file.Name)" -ForegroundColor Green
                    Write-Host "      └─ Size: $('{0:N0}' -f $size) KB" -ForegroundColor Gray
                }
            }
            Write-Host ""
            $totalSize = ($binaries | Measure-Object -Property Length -Sum).Sum / 1KB
            Write-Host "Total size: $('{0:N0}' -f $totalSize) KB" -ForegroundColor Cyan
        } else {
            Write-Host "No binaries found in dist/" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Build directory not found" -ForegroundColor Yellow
    }
    Write-Host ""
}

# Main script execution
switch ($Target.ToLower()) {
    "help" { 
        Print-Help 
    }
    "setup" { 
        if (Check-Setup) { 
            Write-Host ""
            Write-Host "✓ All dependencies are installed" -ForegroundColor Green
        } 
    }
    "build-npm" { 
        if (Check-Setup) { 
            Build-NPM
        } 
    }
    "list-targets" {
        List-Targets
    }
    "build-smtp-native" {
        if (Check-Setup) {
            Build-NPM
            if ($Filter) {
                Write-Host "Filter parameter ignored for native builds" -ForegroundColor Yellow
            }
            # Build for current OS only
            Build-Service -ServiceDir $SMTPDir -ServiceName "email-smtp" -TargetCount 1
            Show-BuildResults
        }
    }
    "build-email-native" {
        if (Check-Setup) {
            Build-NPM
            if ($Filter) {
                Write-Host "Filter parameter ignored for native builds" -ForegroundColor Yellow
            }
            # Build for current OS only
            Build-Service -ServiceDir $EmailDir -ServiceName "email-service" -TargetCount 1
            Show-BuildResults
        }
    }
    "build-bundled" {
        if (Check-Setup) {
            Build-BundledBinaries
        }
    }
    "build-smtp" {
        if (Check-Setup) {
            if (Check-GoWrappers) {
                Build-NPM
                $targetCount = @($BuildTargets | Where-Object { if ($Filter) { $_.Suffix -like "*$Filter*" -or $_.OS -like "*$Filter*" } else { $true } }).Count
                if ($targetCount -eq 0) {
                    Write-Host "No targets match filter: $Filter" -ForegroundColor Red
                    exit 1
                }
                Build-Service -ServiceDir $SMTPDir -ServiceName "email-smtp" -TargetCount $targetCount
                Show-BuildResults
                Organize-BuildOutput
            }
        }
    }
    "build-email" {
        if (Check-Setup) {
            if (Check-GoWrappers) {
                Build-NPM
                $targetCount = @($BuildTargets | Where-Object { if ($Filter) { $_.Suffix -like "*$Filter*" -or $_.OS -like "*$Filter*" } else { $true } }).Count
                if ($targetCount -eq 0) {
                    Write-Host "No targets match filter: $Filter" -ForegroundColor Red
                    exit 1
                }
                Build-Service -ServiceDir $EmailDir -ServiceName "email-service" -TargetCount $targetCount
                Show-BuildResults
                Organize-BuildOutput
            }
        }
    }
    { $_ -in "build", "build-multi" } {
        if (Check-Setup) {
            Build-NPM
            $targetCount = @($BuildTargets | Where-Object { if ($Filter) { $_.Suffix -like "*$Filter*" -or $_.OS -like "*$Filter*" } else { $true } }).Count
            if ($targetCount -eq 0) {
                Write-Host "No targets match filter: $Filter" -ForegroundColor Red
                exit 1
            }
            
            Build-Service -ServiceDir $SMTPDir -ServiceName "email-smtp" -TargetCount $targetCount
            Build-Service -ServiceDir $EmailDir -ServiceName "email-service" -TargetCount $targetCount
            Show-BuildResults
            Organize-BuildOutput
            Write-Host "✓ All builds complete!" -ForegroundColor Green
        }
    }
    "clean" { 
        Clean-Build 
    }
    default {
        Write-Host "Unknown target: $Target" -ForegroundColor Red
        Write-Host ""
        Print-Help
        exit 1
    }
}
