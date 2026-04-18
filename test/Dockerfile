FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY test/e2e.mjs ./

CMD ["node", "e2e.mjs"]
