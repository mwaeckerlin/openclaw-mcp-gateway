FROM mwaeckerlin/nodejs-build as modules
ADD --chown=${BUILD_USER} package.json package.json
ADD --chown=${BUILD_USER} package-lock.json package-lock.json
RUN NODE_ENV=production npm install

FROM modules as build
RUN NODE_ENV=development npm install
ADD --chown=${BUILD_USER} . .
RUN NODE_ENV=production npm run build

FROM mwaeckerlin/nodejs as production
EXPOSE 4000
COPY --from=build /app/dist /app/dist
COPY --from=modules /app/node_modules node_modules
CMD ["dist/server.js"]
