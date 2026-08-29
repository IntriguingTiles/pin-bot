FROM node:24-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

##################

FROM node:24
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY drizzle ./drizzle
RUN mkdir data

USER user
CMD ["node", "dist/bot.js"]