FROM node:20-bookworm-slim

ARG HOMESTEAD_VERSION=0.6.8.64

LABEL org.opencontainers.image.source="https://github.com/tbritton0826/homestead"
LABEL org.opencontainers.image.title="Homestead"
LABEL org.opencontainers.image.version="${HOMESTEAD_VERSION}"

ENV NODE_ENV=production \
    PORT=7312 \
    MEDIA_ROOT=/media \
    HOMESTEAD_DATA_DIR=/app/data

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libheif-examples \
    python3 \
    python3-pip \
    tesseract-ocr \
    tesseract-ocr-eng \
    unzip \
  && rm -rf /var/lib/apt/lists/*

# Background removal is part of the Homestead image, so it works without a
# separate host-side Python install. Keep the model outside /app/data because
# that directory is replaced by the persistent Homestead data mount at runtime.
RUN python3 -m pip install --no-cache-dir --break-system-packages "rembg[cpu,cli]==2.0.84"
ENV REMBG_HOME=/opt/homestead-rembg-models
RUN mkdir -p "$REMBG_HOME" && rembg d u2net

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

EXPOSE 7312

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7312/api/platform').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.cjs"]
