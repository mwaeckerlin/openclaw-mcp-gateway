FROM mwaeckerlin/nodejs-build AS build
USER root
WORKDIR /app
ENV NODE_EXTRA_CA_CERTS=""

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM mwaeckerlin/nodejs AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

CMD ["dist/server.js"]
