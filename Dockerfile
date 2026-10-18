FROM mwaeckerlin/nodejs-build AS modules
ADD --chown=${BUILD_USER} package.json package.json
ADD --chown=${BUILD_USER} package-lock.json package-lock.json
RUN --mount=type=cache,target=/home/coder/.npm,uid=101,gid=1001 NODE_ENV=production npm install

FROM modules AS build
RUN --mount=type=cache,target=/home/coder/.npm,uid=101,gid=1001 NODE_ENV=development npm install
ADD --chown=${BUILD_USER} . .
RUN NODE_ENV=production npm run build:ts

FROM mwaeckerlin/nodejs AS production
EXPOSE 4000
COPY --from=build /app/dist /app/dist
COPY --from=modules /app/node_modules node_modules
COPY --from=build /app/SKILL.md /app/skills/openclaw-mcp-gateway/SKILL.md
# exec form: the image has no shell to run the shell form; the output names
# whether the OpenClaw gateway behind the bridge is reachable
HEALTHCHECK --interval=30s --timeout=20s --start-period=20s --retries=60 \
  CMD ["/usr/bin/node", "-e", "fetch('http://127.0.0.1:4000/healthz').then(async (r)=>{console.log(await r.text());process.exit(r.ok?0:1)}).catch((e)=>{console.log('bridge not answering: '+e.message);process.exit(1)})"]
CMD ["dist/server.js"]
