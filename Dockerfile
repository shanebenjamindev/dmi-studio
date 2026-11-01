# Optional local Node container. Production uses Cloudflare Workers + D1.
# Local SQLite and uploads require a persistent DATA_DIR when used on other hosts.
FROM node:22-bookworm-slim
WORKDIR /app
ENV HOST=0.0.0.0 PORT=10000 DATA_DIR=/tmp/dm-studio

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

EXPOSE 10000
CMD ["node_modules/.bin/tsx", "server/index.ts"]
