#!/bin/bash

# Script to check Prisma migration status
# Usage: ./check-migrations.sh [DATABASE_URL]

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get DATABASE_URL from argument or environment
if [ -n "$1" ]; then
    export DATABASE_URL="$1"
elif [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL not provided${NC}"
    echo "Usage: $0 [DATABASE_URL]"
    echo "Or set DATABASE_URL environment variable"
    exit 1
fi

echo -e "${BLUE}Checking Prisma migration status...${NC}"
echo ""

# Run prisma migrate status
if npx prisma migrate status 2>&1 | tee /tmp/prisma_status.txt; then
    echo ""
    
    # Check if there are pending migrations
    if grep -q "following migration have not yet been applied" /tmp/prisma_status.txt; then
        echo -e "${YELLOW}⚠️  WARNING: There are pending migrations!${NC}"
        echo ""
        echo "To apply pending migrations, run:"
        echo -e "${YELLOW}bunx prisma migrate deploy${NC}"
        exit 1
    elif grep -q "Database schema is up to date" /tmp/prisma_status.txt; then
        echo -e "${GREEN}✅ All migrations applied successfully!${NC}"
        echo ""
        echo "Database schema is in sync."
        exit 0
    else
        echo -e "${YELLOW}⚠️  Unknown status${NC}"
        exit 1
    fi
else
    echo ""
    echo -e "${RED}❌ Failed to check migration status${NC}"
    echo ""
    echo "Possible issues:"
    echo "1. Database connection failed"
    echo "2. Invalid DATABASE_URL"
    echo "3. Prisma not installed"
    exit 1
fi

# Cleanup
rm -f /tmp/prisma_status.txt
