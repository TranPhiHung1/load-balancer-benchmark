FROM node:22-alpine

WORKDIR /app

COPY backend-1/package*.json ./

RUN npm ci --omit=dev

COPY backend-1/server.js ./
COPY shared ./shared
COPY proto ./proto

EXPOSE 3001 50051

CMD ["node", "server.js"]
