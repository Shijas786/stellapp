FROM node:20-slim

# Install Chromium + all Puppeteer dependencies
RUN apt-get update && apt-get install -y \
  chromium \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libxss1 \
  xdg-utils \
  wget \
  --no-install-recommends && \
  rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use system Chromium (skip downloading its own)
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app

COPY package*.json ./

# Install ALL deps including devDependencies (needed for tsc + @types/*)
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

# Build TypeScript (requires devDependencies: typescript, @types/*)
RUN npm run build

# Remove devDependencies after build — production image only needs dist/
RUN npm prune --omit=dev

EXPOSE 3000

CMD ["node", "dist/index.js"]
