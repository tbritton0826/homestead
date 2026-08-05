FROM node:20-alpine

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

EXPOSE 3001

CMD ["node", "server.cjs"]
