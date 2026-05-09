FROM node:20-bookworm-slim AS build

WORKDIR /app

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY apps/api/package.json ./package.json
RUN npm install

COPY apps/api/tsconfig.json ./tsconfig.json
COPY apps/api/prisma ./prisma
COPY apps/api/src ./src

RUN npm run prisma:generate
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/server.js"]
