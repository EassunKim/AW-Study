# AW-Study for study.pacificfish.ca. GitHub Actions builds this on every push to main
# (.github/workflows/publish.yml); the server only downloads the finished image.
#
# Two stages: the first builds the app with all the dev tools, the second keeps only what runs (the
# server and the built files), so the image stays small and holds no build tools.

# --- build ---
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- run ---
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

# The server uses Node's own modules only, so no npm install here
COPY server ./server
COPY --from=build /app/dist ./dist

# Files are owned by root and readable by everyone; nothing is written at runtime, so the
# container can run read-only as an unprivileged user.
USER node
EXPOSE 3000

# node directly, not "npm start": npm writes logs into a home folder a read-only container lacks
CMD ["node", "server/server.mjs"]
