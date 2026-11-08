FROM node:22-alpine

WORKDIR /app

COPY backend-2/package*.json ./

RUN npm ci --omit=dev

COPY backend-2/server.js ./
COPY shared ./shared
COPY proto ./proto

EXPOSE 3002 50051

CMD ["node", "server.js"]
