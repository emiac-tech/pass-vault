# syntax=docker/dockerfile:1
# Single image that serves BOTH the built web app and the API on one port (4000).
# The database is external (configured via DATABASE_URL in the environment).

# ---------- build stage ----------
FROM node:22-slim AS build
WORKDIR /app

# Install all dependencies (including dev) needed to build.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build the web app pointed at the same origin's /api (the API serves the SPA),
# then compile the API to server-dist/.
RUN VITE_API_BASE_URL=/api npm run build \
  && npm run build:api

# ---------- runtime stage ----------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled API + built web bundle + SQL migrations + public landing site.
COPY --from=build /app/server-dist ./server-dist
COPY --from=build /app/dist ./dist
COPY --from=build /app/database ./database
COPY --from=build /app/public-site ./public-site

EXPOSE 4000
CMD ["node", "server-dist/server/index.js"]
