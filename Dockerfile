FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY README.md ./

ENV NODE_ENV=production
EXPOSE 7001

CMD ["node", "src/server.js"]
