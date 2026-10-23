# Local, self-contained runtime. Host node_modules and dotenv files are excluded.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node prisma ./prisma
RUN npm ci && npx prisma generate
COPY --chown=node:node . .
RUN npm run css:build && npm run build \
    && mkdir -p public/uploads var/private-assets var/bootstrap
EXPOSE 3000
CMD ["node", "dist/server.js"]
