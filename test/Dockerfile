FROM mwaeckerlin/nodejs-build as modules
ADD --chown=${BUILD_USER} package.json package.json
ADD --chown=${BUILD_USER} package-lock.json package-lock.json
RUN NODE_ENV=production npm install

FROM mwaeckerlin/nodejs
COPY --from=modules /app/node_modules node_modules
COPY test/e2e.mjs .

CMD ["e2e.mjs"]
