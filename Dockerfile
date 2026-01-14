# Use official Bun image
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS install
RUN mkdir -p /temp/prod
COPY package.json bun.lockb /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# Copy application code
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY . .

# Create data directory (will be mounted by persistent disk)
RUN mkdir -p /data

# Expose port
EXPOSE 5123

# Set user (optional, for security)
USER bun

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD bun run -e "fetch('http://localhost:5123/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the bot
ENTRYPOINT ["bun", "run", "start"]
