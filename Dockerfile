# DM Studio: one container serving the API and the built web app. Data (SQLite, local uploads) lives in DATA_DIR,
# which must be a persistent disk/volume on the host.
FROM node:22-bookworm-slim
WORKDIR /app
ENV HOST=0.0.0.0 PORT=10000 DATA_DIR=/var/data

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

EXPOSE 10000
CMD ["node_modules/.bin/tsx", "server/index.ts"]
