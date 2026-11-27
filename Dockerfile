# Portable Dockerfile for Dhruv Tales (Cloud Run, Render, Railway, Fly.io, VPS, Coolify, AWS)
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json bun.lock* package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/api ./api
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/firebase-applet-config.json ./firebase-applet-config.json
COPY --from=builder /app/src/types ./src/types
COPY --from=builder /app/src/services/access ./src/services/access
COPY --from=builder /app/src/services/payments ./src/services/payments
COPY --from=builder /app/src/services/siteSettings ./src/services/siteSettings
COPY --from=builder /app/src/services/firebase/config.ts ./src/services/firebase/config.ts

EXPOSE 3000
CMD ["npm", "start"]
