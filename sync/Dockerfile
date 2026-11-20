# The sync server (sync/, #95): Google sign-in and accounts now, encrypted sync later
# (docs/SECURITY.md, "Accounts and sync"). Node's own modules only, its data in one SQLite file in
# /data. GitHub Actions builds and publishes ghcr.io/nandminc/aw-study-sync:main on every push to main
# (.github/workflows/publish.yml). Run it read-only, as the TrueNAS apps user, with /data mounted.
FROM node:24-alpine

WORKDIR /app
COPY app.mjs db.mjs google.mjs server.mjs ./

ENV NODE_ENV=production \
    PORT=3002 \
    DATA_DIR=/data \
    NODE_NO_WARNINGS=1

# Files owned by root and readable by everyone; the server (TrueNAS runs it as 568) only writes /data
USER node
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3002/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "server.mjs"]
