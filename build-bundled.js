#!/usr/bin/env node
/**
 * Bundled Build System for Email Service
 * Creates truly self-contained executables with all dependencies bundled
 * Uses esbuild to bundle Node.js code + all npm modules
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const DIST_DIR = path.join(__dirname, 'dist-bundled');
const NODE_DIR = path.join(__dirname, 'node', 'email-sender');
const SERVICE_BIN_DIR = path.join(__dirname, '..', 'back-end', 'service-bin', 'email_service');

// Platform configurations
const platforms = [
  // Windows
  { os: 'windows', arch: 'amd64', goarch: 'amd64', ext: '.exe', node: 'win-x64' },
  { os: 'windows', arch: '386', goarch: '386', ext: '.exe', node: 'win-ia32' },
  { os: 'windows', arch: 'arm64', goarch: 'arm64', ext: '.exe', node: 'win-arm64' },
  // Linux
  { os: 'linux', arch: 'amd64', goarch: 'amd64', ext: '', node: 'linux-x64' },
  { os: 'linux', arch: '386', goarch: '386', ext: '', node: 'linux-ia32' },
  { os: 'linux', arch: 'arm64', goarch: 'arm64', ext: '', node: 'linux-arm64' },
  { os: 'linux', arch: 'arm', goarch: 'arm', ext: '', node: 'linux-armv7l' },
  // macOS
  { os: 'darwin', arch: 'amd64', goarch: 'amd64', ext: '', node: 'macos-x64' },
  { os: 'darwin', arch: 'arm64', goarch: 'arm64', ext: '', node: 'macos-arm64' },
  // FreeBSD
  { os: 'freebsd', arch: 'amd64', goarch: 'amd64', ext: '', node: 'freebsd-x64' },
  // OpenBSD
  { os: 'openbsd', arch: 'amd64', goarch: 'amd64', ext: '', node: 'openbsd-x64' },
];

// Ensure dist directory exists
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

/**
 * Bundle SMTP Server
 */
async function bundleSmtpServer() {
  console.log('\n📦 Building bundled SMTP Server...');
  const entry = path.join(NODE_DIR, 'build', 'smtp-server.js');
  const outfile = path.join(DIST_DIR, 'email-smtp-bundled.cjs');

  try {
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: outfile,
      external: [], // Bundle everything
      minify: false,
      sourcemap: false,
      logLevel: 'info',
    });
    console.log(`✅ SMTP Server bundled: ${outfile}`);
    return outfile;
  } catch (error) {
    console.error('❌ Failed to bundle SMTP Server:', error.message);
    throw error;
  }
}

/**
 * Bundle Email Service
 */
async function bundleEmailService() {
  console.log('\n📦 Building bundled Email Service...');
  const entry = path.join(NODE_DIR, 'build', 'email-service.js');
  const outfile = path.join(DIST_DIR, 'email-service-bundled.cjs');

  try {
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: outfile,
      external: [], // Bundle everything
      minify: false,
      sourcemap: false,
      logLevel: 'info',
    });
    console.log(`✅ Email Service bundled: ${outfile}`);
    return outfile;
  } catch (error) {
    console.error('❌ Failed to bundle Email Service:', error.message);
    throw error;
  }
}

/**
 * Use pkg to create executable from bundled JS
 * pkg converts Node.js + bundled code into platform-specific executable
 */
async function createExecutables(smtpBundled, serviceBundled) {
  console.log('\n🔨 Creating platform-specific executables with pkg...');
  
  // Check if pkg is installed
  try {
    execSync('npm list -g pkg', { stdio: 'ignore' });
  } catch {
    console.log('📥 Installing pkg globally...');
    execSync('npm install -g pkg', { stdio: 'inherit' });
  }

  for (const platform of platforms) {
    console.log(`\n🏗️  Building ${platform.os}-${platform.arch}...`);

    // SMTP Server executable
    const smtpTarget = `node18-${platform.node}`;
    const smtpOut = path.join(DIST_DIR, `email-smtp-${platform.os}-${platform.arch}${platform.ext}`);
    try {
      execSync(`pkg "${smtpBundled}" --compress Brotli --target ${smtpTarget} --output "${smtpOut}"`, {
        stdio: 'inherit',
        cwd: DIST_DIR,
      });
      console.log(`✅ SMTP: ${path.basename(smtpOut)}`);
    } catch (error) {
      console.error(`❌ SMTP failed for ${platform.os}-${platform.arch}:`, error.message);
    }

    // Email Service executable
    const serviceTarget = `node18-${platform.node}`;
    const serviceOut = path.join(DIST_DIR, `email-service-${platform.os}-${platform.arch}${platform.ext}`);
    try {
      execSync(`pkg "${serviceBundled}" --compress Brotli --target ${serviceTarget} --output "${serviceOut}"`, {
        stdio: 'inherit',
        cwd: DIST_DIR,
      });
      console.log(`✅ Service: ${path.basename(serviceOut)}`);
    } catch (error) {
      console.error(`❌ Service failed for ${platform.os}-${platform.arch}:`, error.message);
    }
  }
}

/**
 * Copy executables to service-bin directory
 */
function deployExecutables() {
  console.log('\n📤 Deploying executables to service-bin...');

  if (!fs.existsSync(SERVICE_BIN_DIR)) {
    fs.mkdirSync(SERVICE_BIN_DIR, { recursive: true });
  }

  const files = fs.readdirSync(DIST_DIR).filter(f => 
    (f.startsWith('email-smtp-') || f.startsWith('email-service-')) &&
    !f.includes('bundled')
  );

  files.forEach(file => {
    const src = path.join(DIST_DIR, file);
    const dest = path.join(SERVICE_BIN_DIR, file);
    fs.copyFileSync(src, dest);
    // Make executable on Unix
    if (process.platform !== 'win32') {
      fs.chmodSync(dest, 0o755);
    }
    console.log(`✅ ${file}`);
  });

  console.log(`\n📁 Executables deployed to: ${SERVICE_BIN_DIR}`);
}

/**
 * Main build process
 */
async function build() {
  try {
    console.log('🚀 Starting bundled build for Email Service\n');
    console.log('Platform targets:', platforms.length);
    console.log('Output dir:', DIST_DIR);

    // Step 1: Bundle with esbuild
    const smtpBundled = await bundleSmtpServer();
    const serviceBundled = await bundleEmailService();

    // Step 2: Create executables with pkg
    await createExecutables(smtpBundled, serviceBundled);

    // Step 3: Deploy
    deployExecutables();

    console.log('\n✨ Build complete!');
    console.log('Executables are now truly self-contained with all dependencies bundled.\n');
  } catch (error) {
    console.error('\n❌ Build failed:', error);
    process.exit(1);
  }
}

build();
