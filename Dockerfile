FROM node:20-alpine
LABEL org.opencontainers.image.source="https://github.com/tbritton0826/homestead"

RUN apk add --no-cache \
    ffmpeg \
    tesseract-ocr \
    tesseract-ocr-data-eng \
    unzip

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

EXPOSE 7312

CMD ["node", "server.cjs"]
