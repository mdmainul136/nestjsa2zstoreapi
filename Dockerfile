# ─── 1. Build Stage ───
FROM node:20-alpine AS builder

WORKDIR /app

# Install native dependencies for Prisma & Alpine
RUN apk add --no-cache openssl libc6-compat

COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies for build)
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

# Generate Prisma Client for Linux Alpine
RUN npx prisma generate

# Build NestJS production bundle
RUN npm run build

# Remove development dependencies to keep image size small
RUN npm prune --production

# ─── 2. Production Runner Stage ───
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5001

RUN apk add --no-cache openssl libc6-compat curl

# Copy production artifacts
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Create shared uploads folder
RUN mkdir -p /app/uploads

EXPOSE 5001

HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:5001/ || exit 1

CMD ["node", "dist/main.js"]
