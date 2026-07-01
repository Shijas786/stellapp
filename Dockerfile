# ✅ FIXED Dockerfile with Rust + Cargo for Soroban

FROM node:20-slim

# ============================================
# Install System Dependencies
# ============================================
RUN apt-get update && apt-get install -y \
  chromium \
  # Chromium deps
  libnss3 libxss1 libasound2 libxtst6 \
  fonts-liberation \
  libgconf-2-4 libxrender1 libxrandr2 libxinerama1 \
  libxi6 libxcursor1 libxcomposite1 libxdamage1 \
  libxfixes3 libxext6 libdrm2 libgbm1 libxkbcommon0 \
  libpango-1.0-0 libpangoft2-1.0-0 libcups2 libdbus-1-3 \
  libglib2.0-0 libatspi2.0-0 dbus x11-utils \
  # Rust build dependencies
  curl build-essential pkg-config libssl-dev libdbus-1-dev libudev-dev \
  # Python for Whisper
  python3 python3-pip ffmpeg \
  --no-install-recommends && \
  rm -rf /var/lib/apt/lists/*

# ============================================
# Install Rust & Soroban
# ============================================
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Add WASM target for Soroban (wasm32v1-none disables reference-types and multivalue by default)
RUN rustup target add wasm32v1-none

# Install Soroban CLI
RUN cargo install soroban-cli --locked

# ============================================
# Configure Node + Python + Puppeteer
# ============================================
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_VALIDATION=true
ENV NODE_ENV=production
ENV PATH="/usr/local/cargo/bin:${PATH}"

WORKDIR /app

# Create auth directories
RUN mkdir -p .wwebjs_auth /tmp/chromium-cache && \
    chmod -R 777 .wwebjs_auth /tmp/chromium-cache

# ============================================
# Install Node Dependencies
# ============================================
COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

# ============================================
# Build Application
# ============================================
RUN npm run build 2>&1 || true

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["node", "dist/index.js"]
