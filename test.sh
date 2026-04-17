#!/bin/bash

# Email Service Test Script

API_URL="http://localhost:3430"

echo "📬 Email Service Test Suite"
echo "============================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if service is running
echo "👉 Checking if service is running..."
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" $API_URL/health)

if [ "$HEALTH" != "200" ] && [ "$HEALTH" != "503" ]; then
    echo -e "${RED}❌ Service not running on $API_URL${NC}"
    echo "Start the service with: npm start"
    exit 1
fi

echo -e "${GREEN}✓ Service is running${NC}"
echo ""

# Test 1: Health Check
echo "📋 Test 1: Health Check"
echo "GET /health"
echo ""
RESPONSE=$(curl -s $API_URL/health)
echo "Response: $RESPONSE"
echo ""

# Test 2: Send Simple Email
echo "📋 Test 2: Send Simple Email"
echo "POST /email/send"
echo ""
RESPONSE=$(curl -s -X POST $API_URL/email/send \
    -H "Content-Type: application/json" \
    -d '{
        "to": "user@example.com",
        "subject": "Test Email",
        "html": "<h1>Hello World</h1><p>This is a test email from the email service.</p>",
        "text": "Hello World\n\nThis is a test email from the email service."
    }')
echo "Response: $RESPONSE"
echo ""

# Test 3: Send Template Email
echo "📋 Test 3: Send Template Email"
echo "POST /email/send-template"
echo ""
RESPONSE=$(curl -s -X POST $API_URL/email/send-template \
    -H "Content-Type: application/json" \
    -d '{
        "to": "user@example.com",
        "subject": "Welcome {{name}}",
        "template": "<h1>Welcome {{name}}!</h1><p>Your email is {{email}}</p>",
        "data": {
            "name": "John Doe",
            "email": "john@example.com"
        }
    }')
echo "Response: $RESPONSE"
echo ""

# Test 4: Send Verification Email
echo "📋 Test 4: Send Verification Email"
echo "POST /email/verification"
echo ""
RESPONSE=$(curl -s -X POST $API_URL/email/verification \
    -H "Content-Type: application/json" \
    -d '{
        "email": "user@example.com",
        "token": "verification-token-abc123xyz"
    }')
echo "Response: $RESPONSE"
echo ""

# Test 5: Send Password Reset Email
echo "📋 Test 5: Send Password Reset Email"
echo "POST /email/password-reset"
echo ""
RESPONSE=$(curl -s -X POST $API_URL/email/password-reset \
    -H "Content-Type: application/json" \
    -d '{
        "email": "user@example.com",
        "token": "reset-token-def456uvw"
    }')
echo "Response: $RESPONSE"
echo ""

# Test 6: Send Welcome Email
echo "📋 Test 6: Send Welcome Email"
echo "POST /email/welcome"
echo ""
RESPONSE=$(curl -s -X POST $API_URL/email/welcome \
    -H "Content-Type: application/json" \
    -d '{
        "email": "user@example.com",
        "name": "John Doe"
    }')
echo "Response: $RESPONSE"
echo ""

# Test 7: Send Order Confirmation
echo "📋 Test 7: Send Order Confirmation"
echo "POST /email/order-confirmation"
echo ""
RESPONSE=$(curl -s -X POST $API_URL/email/order-confirmation \
    -H "Content-Type: application/json" \
    -d '{
        "email": "user@example.com",
        "orderData": {
            "orderId": "ORD-12345",
            "total": 99.99
        }
    }')
echo "Response: $RESPONSE"
echo ""

# Test 8: Send Notification
echo "📋 Test 8: Send Notification"
echo "POST /email/notify"
echo ""
RESPONSE=$(curl -s -X POST $API_URL/email/notify \
    -H "Content-Type: application/json" \
    -d '{
        "to": "user@example.com",
        "title": "Important Notification",
        "message": "Your account settings have been updated successfully.",
        "actionUrl": "http://localhost:3000/settings",
        "actionText": "View Settings"
    }')
echo "Response: $RESPONSE"
echo ""

# Test 9: Invalid Request (missing required fields)
echo "📋 Test 9: Invalid Request (Missing Fields)"
echo "POST /email/send (missing 'subject' and 'html')"
echo ""
RESPONSE=$(curl -s -X POST $API_URL/email/send \
    -H "Content-Type: application/json" \
    -d '{
        "to": "user@example.com"
    }')
echo "Response: $RESPONSE"
echo ""

# Test 10: 404 Not Found
echo "📋 Test 10: 404 Not Found"
echo "GET /invalid-endpoint"
echo ""
RESPONSE=$(curl -s $API_URL/invalid-endpoint)
echo "Response: $RESPONSE"
echo ""

echo "============================"
echo -e "${GREEN}✓ All tests completed!${NC}"
echo ""
echo "Note: Email sending requires Postfix to be running on localhost:25"
echo "Check Postfix mail queue with: mailq"
echo "View mail logs with: tail -f /var/log/mail.log"
