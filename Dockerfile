# CareNest — one image runs the web app, the background worker and migrations:
#   web:     npm start
#   worker:  npm run worker
#   migrate: npm run db:migrate
# Requires PostgreSQL (DATABASE_URL). See docs/DEPLOYMENT.md.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
WORKDIR /app
# tsx (used by the worker and migrations) is a dev dependency, so the full install is kept.
COPY --from=build --chown=node:node /app ./
# Uploaded health documents live here (a volume in production); it must belong to the app user.
ENV DOCUMENT_STORAGE_DIR=/data/documents
RUN mkdir -p /data/documents && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
