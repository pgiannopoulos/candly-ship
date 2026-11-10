# ── deps ──
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ── build ──
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npx next build

# ── run ──
FROM node:22-alpine AS run
WORKDIR /app
RUN apk add --no-cache openssl && addgroup -S app && adduser -S app -G app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
# Prisma CLI (with all its dependencies) for applying the schema at startup — same version as the app
COPY --from=build /app/node_modules/prisma/package.json /tmp/prisma-version.json
RUN npm install -g "prisma@$(node -p "require('/tmp/prisma-version.json').version")" --no-audit --no-fund && npm cache clean --force
USER app
EXPOSE 3000
# Apply schema on start, then boot Next.js
CMD ["sh", "-c", "prisma db push --skip-generate && node server.js"]
