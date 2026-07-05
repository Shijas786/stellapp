# ✅ FIXED Dockerfile with Rust + Cargo for Soroban

FROM node:20-slim

# ============================================
# Install System Dependencies
# ============================================
RUN apt-get update && apt-get install -y \
  chromium \
  # Chromium core runtime deps
  libnss3 libnspr4 libxss1 libasound2 libxtst6 \
  fonts-liberation \
  libgconf-2-4 libxrender1 libxrandr2 libxinerama1 \
  libxi6 libxcursor1 libxcomposite1 libxdamage1 \
  libxfixes3 libxext6 libdrm2 libgbm1 libxkbcommon0 \
  libpango-1.0-0 libpangoft2-1.0-0 libcups2 libdbus-1-3 \
  libglib2.0-0 libatspi2.0-0 libatk1.0-0 libatk-bridge2.0-0 \
  libgtk-3-0 libpangocairo-1.0-0 libx11-xcb1 libxcb1 \
  libgdk-pixbuf2.0-0 ca-certificates xdg-utils \
  dbus x11-utils \
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

# Install Stellar/Soroban CLI (pre-compiled binary) v27.0.0
RUN curl -sSLo stellar-cli.tar.gz https://github.com/stellar/stellar-cli/releases/download/v27.0.0/stellar-cli-27.0.0-x86_64-unknown-linux-gnu.tar.gz && \
    tar -xzf stellar-cli.tar.gz && \
    mv stellar /usr/local/bin/stellar && \
    ln -s /usr/local/bin/stellar /usr/local/bin/soroban && \
    rm stellar-cli.tar.gz


# ============================================
# Configure Node + Python + Puppeteer
# ============================================
ENV PATH="/usr/local/cargo/bin:${PATH}"

WORKDIR /app

# Create auth directories
RUN mkdir -p .wwebjs_auth /tmp/chromium-cache && \
    chmod -R 777 .wwebjs_auth /tmp/chromium-cache

# ============================================
# Build Application
# ============================================
# Remove NODE_ENV=production during build so devDependencies are installed
ENV NODE_ENV=development
COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

# ============================================
# Pre-warm Soroban Compiler Dependency Cache
# ============================================
# Copy the compiler template and pre-compile all dependencies during image build.
# This ensures stellar-xdr, soroban-sdk, etc. are already compiled in the image
# layer. At runtime, only the user's custom lib.rs needs to be recompiled,
# which uses very little memory and time.
COPY compiler_template ./compiler_template
RUN cd compiler_template && \
    cargo build --target wasm32v1-none --release && \
    echo "[Docker] Soroban dependency cache pre-warmed successfully."

# Now copy the rest of the app
COPY . .

# Set NODE_ENV to production BEFORE building Next.js to prevent mixed React environments
ENV NODE_ENV=production

# Run build WITHOUT ignoring errors
RUN npm run build

# Ensure production environment for runtime
ENV NODE_ENV=production

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["sh", "-c", "node scripts/setup-db-provider.js && npx prisma db push --accept-data-loss && node dist/index.js"]
