# Cloudflare Tunnel Setup Guide

This guide explains how to configure and use Cloudflare Tunnel with your email service to securely expose your SMTP and Email API to the internet.

## Overview

When enabled, Cloudflare Tunnel automatically:
- Establishes a secure tunnel from your local services to Cloudflare
- Routes incoming SMTP traffic to `smtp.{DOMAIN}`
- Routes incoming API traffic to `api.{DOMAIN}`
- Encrypts all traffic through the tunnel
- Does NOT require opening ports 25 or 3001 to the internet

## Prerequisites

1. **Cloudflare Account**: Sign up at https://www.cloudflare.com/
2. **Registered Domain**: Use your Cloudflare nameservers (e.g., `httpsbuffcowland.in`)
3. **cloudflared CLI**: Install from https://github.com/cloudflare/cloudflared/releases
   - Windows: Download `cloudflared-windows-*.exe`, rename to `cloudflared.exe`, add to PATH
   - Linux: `sudo apt-get install cloudflare-warp` or download binary
   - macOS: `brew install cloudflare/cloudflare/cloudflared`

## Step 1: Get Cloudflare Tunnel Token

### Via Web Dashboards

1. Go to https://dash.cloudflare.com
2. Select your account → Click "Access" (under Zero Trust) → "Tunnels"
3. Click "Create a tunnel" → Choose "Cloudflared" → Give it a name (e.g., "email-service")
4. You'll get a token - copy it (looks like: `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/xxxxxxxxxxxxxxxxxxxxxxxx`)
5. **DO NOT run the quickstart yet** - we'll use our configuration

### Via cloudflared CLI (Alternative)

```bash
cloudflared tunnel create email-service
# This creates the tunnel and generates a config file
# Your token will be displayed - copy it
```

## Step 2: Find Your Account ID

1. Go to https://dash.cloudflare.com
2. In the URL bar: `https://dash.cloudflare.com/?to=/:account/`
3. The `:account` part is your **Account ID** (a hex string like `abc123def456`)
4. Alternatively, check **Account Information** in the sidebar

## Step 3: Configure Environment Variables

Edit `.env` (or create from `.env.example`) with your Cloudflare credentials:

```bash
# Enable the tunnel
CF_TUNNEL_ENABLED=true

# Your unique tunnel token (from Step 1)
CF_TUNNEL_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/xxxxxxxxxxxxxxxxxxxxxxxx

# Your Cloudflare Account ID (from Step 2)
CF_ACCOUNT_TAG=abc123def456

# Your registered domain
CF_DOMAIN=httpsbuffcowland.in

# Optional: Tunnel name for readability
CF_TUNNEL_NAME=email-service-tunnel
```

## Step 4: Set Up DNS Records in Cloudflare

In your Cloudflare account:

1. Go to your domain (e.g., `httpsbuffcowland.in`)
2. Navigate to "DNS" → "Records"
3. Create two CNAME records:

| Type | Name | Content | TTL |
|------|------|---------|-----|
| CNAME | smtp | `<tunnel-uuid>.cfargotunnel.com` | Auto |
| CNAME | api | `<tunnel-uuid>.cfargotunnel.com` | Auto |

**Note**: Replace `<tunnel-uuid>` with your tunnel's UUID (available in the Tunnel details page)

## Step 5: Build and Run Services

### For Production Binary Deployment

The Cloudflare credentials can be embedded in the binary at build time:

```powershell
# Windows PowerShell
$env:CF_TUNNEL_ENABLED = "true"
$env:CF_TUNNEL_TOKEN = "your-token-here"
$env:CF_ACCOUNT_TAG = "your-account-id"
$env:CF_DOMAIN = "httpsbuffcowland.in"

# Run the build script
.\build.ps1 build
```

The credentials will be:
1. Picked up by the GO wrapper
2. Passed to Node.js via environment variables
3. Embedded in the deployed binary's configuration

### For Development/Testing

```bash
# Set environment variables
export CF_TUNNEL_ENABLED=true
export CF_TUNNEL_TOKEN=your-token
export CF_ACCOUNT_TAG=your-account-id
export CF_DOMAIN=httpsbuffcowland.in

# Start the services
npm start
```

## Step 6: Verify Tunnel Status

Once services start, check the logs:

### Expected Log Output

**Email Service (port 3001):**
```
☁️  Loading Cloudflare Tunnel configuration...
☁️  Cloudflare Tunnel Status:
   Status: CONNECTED
   Domain: httpsbuffcowland.in
   Public URL: api.httpsbuffcowland.in
   Routes:
     • emailService → api.httpsbuffcowland.in
       (localhost:3001)
     • emailSMTP → smtp.httpsbuffcowland.in
       (localhost:25)
```

**SMTP Server (port 25):**
```
☁️  Loading Cloudflare Tunnel configuration...
☁️  Cloudflare Tunnel Status:
   Status: CONNECTED
   Domain: httpsbuffcowland.in
   Routes:
     • emailSMTP → smtp.httpsbuffcowland.in
       (localhost:25)
     • emailService → api.httpsbuffcowland.in
       (localhost:3001)
```

## Testing the Tunnel

### Test SMTP Connection

```bash
# From your local machine
nslookup smtp.httpsbuffcowland.in

# Should return Cloudflare's IP address
# Then test SMTP connection
telnet smtp.httpsbuffcowland.in 25
# Should connect to your tunnel and forward to localhost:25
```

### Test Email API

```bash
# Send a test email through the tunnel
curl -X POST https://api.httpsbuffcowland.in/api/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "recipient@example.com",
    "subject": "Test via Tunnel",
    "html": "<p>This email came through Cloudflare Tunnel!</p>"
  }'
```

## Troubleshooting

### "cloudflared binary not found"

**Problem**: The tunnel client can't find the `cloudflared` executable

**Solution**:
1. Verify `cloudflared` is installed: `cloudflared --version`
2. Add to PATH environment variable:
   - **Windows**: Add folder containing `cloudflared.exe` to System PATH
   - **Linux/macOS**: Ensure `/usr/local/bin/cloudflared` or similar is in $PATH
3. Restart the service after adding to PATH

### "Cloudflare Tunnel configuration incomplete"

**Problem**: Missing required environment variables

**Solution**: Check these are set:
```bash
CF_TUNNEL_ENABLED=true
CF_TUNNEL_TOKEN=<actual-token>  # Not empty/placeholder
CF_ACCOUNT_TAG=<actual-id>      # Hex account ID
CF_DOMAIN=<your-domain>         # Your registered domain
```

### "Connected but DNS not resolving"

**Problem**: Tunnel is connected but `smtp.domain.com` doesn't resolve

**Solution**: 
1. Verify CNAME records are created in Cloudflare DNS
2. Wait 5-10 minutes for DNS propagation
3. Check tunnel UUID in CNAME records matches your tunnel
4. Test with `nslookup smtp.domain.com`

### "Tunnel connection keeps dropping"

**Problem**: Tunnel reconnects frequently

**Solution**:
1. Check internet stability
2. Verify `cloudflared` is up to date: `cloudflared update`
3. Check logs for specific error messages
4. Increase reconnect delay in `tunnelClient.ts` if needed:
   ```typescript
   private reconnectDelay = 10000; // Increase from 5000ms
   ```

### "Email not sending through tunnel"

**Problem**: Email sends locally but fails through tunnel

**Solution**:
1. Verify SMTP is actually running: `telnet localhost 25`
2. Check tunnel is connected (see Step 6)
3. Test direct SMTP bypass: Set `CF_TUNNEL_ENABLED=false`
4. Check firewall isn't blocking localhost:25

## Advanced Configuration

### Custom Tunnel Credentials File

Instead of environment variables, you can use a tunnel credentials file:

```bash
# Create tunnel credential JSON (from cloudflared login)
# Location: ~/.cloudflare-warp/cert.pem (certificate)
# This is advanced - use environment variables for simplicity
```

### Multiple Domains

To route multiple domains through one tunnel, extend the routes in `cloudflareConfig.ts`:

```typescript
const routes: TunnelRoute[] = [
  {
    service: 'emailSMTP',
    publicHostname: `smtp.${domain}`,
    localPort: parseInt(process.env.SMTP_PORT || '25', 10),
  },
  {
    service: 'emailService',
    publicHostname: `api.${domain}`,
    localPort: parseInt(process.env.PORT || '3001', 10),
  },
  {
    // Add more routes as needed
    service: 'webhook',
    publicHostname: `webhook.${domain}`,
    localPort: 3002,
  },
];
```

### Disabling Tunnel Temporarily

```bash
CF_TUNNEL_ENABLED=false
# Services will use direct connections (no tunnel)
# Useful for local development or troubleshooting
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│           Your Server (Behind NAT/Firewall)             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────┐        ┌──────────────────┐       │
│  │  SMTP Server    │        │  Email Service   │       │
│  │  localhost:25   │        │  localhost:3001  │       │
│  └────────┬────────┘        └────────┬─────────┘       │
│           │                           │                 │
│           └──────────┬────────────────┘                 │
│                      │                                  │
│            ┌─────────▼──────────┐                       │
│            │ Cloudflare Tunnel  │                       │
│            │ Client (tunnelClient)                      │
│            │ Manages connection │                       │
│            └─────────┬──────────┘                       │
│                      │                                  │
│                  [HTTPS Tunnel]                         │
│                      │                                  │
├─────────────────────┼──────────────────────────────────┤
│                     │ Cloudflare Global Network        │
│                ┌────▼────────────────┐                 │
│                │ Tunnel Edge Servers │                 │
│                └────┬────────────────┘                 │
├────────────────────┼──────────────────────────────────┤
│                    │         Internet                  │
│         ┌──────────▼────────────┐                      │
│         │  DNS Resolution       │                      │
│         │  smtp.domain.com ──┐  │                      │
│         │  api.domain.com ───┤  │                      │
│         │       └─ Cloudflare IPs                      │
│         └───────────────────┘                          │
│                 ▲                                       │
│                 │                                       │
│      ┌──────────▼──────────┐                           │
│      │ SMTP/Email Clients  │                           │
│      │ External Systems    │                           │
│      └─────────────────────┘                           │
└─────────────────────────────────────────────────────────┘
```

## Security Best Practices

1. **Protect Your Token**: Treat `CF_TUNNEL_TOKEN` like a password
   - Don't commit to version control
   - Use environment variables or secrets management
   - Rotate tokens periodically in Cloudflare dashboard

2. **Use HTTPS**: Enable TLS for API access
   - Cloudflare tunnel provides HTTPS automatically
   - Internal traffic to localhost can be HTTP

3. **Monitor Connections**: Check tunnel logs regularly
   ```bash
   cloudflared tunnel run --url localhost:25 email-tunnel
   # Shows real-time connection logs
   ```

4. **Firewall Rules**: In Cloudflare, set up firewall rules for:
   - Rate limiting on API endpoint
   - Geographic restrictions if needed
   - IP allowlisting for SMTP if applicable

## References

- **Cloudflare Tunnel Docs**: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/
- **cloudflared GitHub**: https://github.com/cloudflare/cloudflared
- **Zero Trust Architecture**: https://www.cloudflare.com/products/zero-trust/

## Support

For issues with Cloudflare Tunnel:
1. Check Cloudflare Community: https://community.cloudflare.com/
2. Review logs in this service: Check `tunnelClient.ts` logging
3. Test cloudflared directly: `cloudflared tunnel run <tunnel-name>`

For issues with email service:
1. Check domain configuration: Verify `domainChecker.ts` output at startup
2. Test SMTP directly: `telnet localhost 25`
3. Review logs: Check `LOG_LEVEL=debug` for detailed output
