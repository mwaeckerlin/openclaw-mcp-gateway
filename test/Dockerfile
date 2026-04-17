FROM mwaeckerlin/nodejs-build
USER root

WORKDIR /workspace
ENV NODE_EXTRA_CA_CERTS=""

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

CMD ["npm", "run", "test"]
