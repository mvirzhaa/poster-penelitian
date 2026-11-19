FROM node:20-bookworm-slim

# Pasang Chromium dan font pendukung agar rendering poster sempurna
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-freefont-ttf \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV CHROME_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p uploads cache

EXPOSE 3000

CMD ["node", "src/server.js"]
