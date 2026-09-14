FROM node:22-alpine
WORKDIR /app
COPY apps/presence-gateway/package.json ./package.json
COPY apps/presence-gateway/server.mjs ./server.mjs
EXPOSE 3444
CMD ["node","server.mjs"]
