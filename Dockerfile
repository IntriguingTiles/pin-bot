FROM node:24 AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

##################

FROM node:24 AS builder-stage2
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

##################

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder-stage2 /app/node_modules ./node_modules
COPY package*.json ./

COPY --from=builder /app/dist ./dist
COPY drizzle ./drizzle
RUN mkdir data

USER node
STOPSIGNAL SIGINT
CMD ["node", "dist/bot.js"]
