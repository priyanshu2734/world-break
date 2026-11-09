# World//Break: multi-stage build. One process serves the page and the WebSocket on $PORT (default 3001).
# NOT RUN in this milestone (no Docker in the build sandbox): see docs/DEPLOYMENT.md, first-deploy checklist.

# ---- build: all dependencies, typecheck-free bundle of the server, Vite build of the client
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci
COPY packages ./packages
COPY scripts ./scripts
RUN npm run build:server && npm run build:client

# ---- runtime: production dependencies of the server only, the two build outputs, a non-root user
FROM node:22-slim AS run
ENV NODE_ENV=production PORT=3001 DATABASE_PATH=/data/world-break.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --omit=dev -w @wb/server --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist
COPY scripts/start.mjs scripts/start.mjs
# /data is where the SQLite file lives: mount a persistent volume there
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3001
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# `npm start` runs exactly this file; node is used directly so SIGTERM reaches the server (graceful shutdown)
CMD ["node", "scripts/start.mjs"]
