FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Produção ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache python3 make g++   # native addons para better-sqlite3

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

RUN mkdir -p /app/data

EXPOSE 3001
ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/app/data/licencas.db

CMD ["node", "dist/index.js"]
