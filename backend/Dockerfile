# =======================================================
# MERYA DZ Backend — Production Dockerfile
# Node.js 22 LTS, Non-root execution, Layer Caching & Health Check
# =======================================================

FROM node:22-slim

# Install curl for container health checks
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set default production environment
ENV NODE_ENV=production
ENV PORT=5000

# Copy package manifests first to leverage Docker layer caching
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy backend application source and static catalog assets
COPY src/ ./src/
COPY uploads/ ./uploads/
COPY scripts/ ./scripts/

# Create uploads directory if missing and set permissions
RUN mkdir -p /app/uploads && chown -R node:node /app

# Run as non-root user for security
USER node

# Expose API and WebSocket port
EXPOSE 5000

# Container Health Check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

# Start server
CMD ["node", "src/server.js"]
