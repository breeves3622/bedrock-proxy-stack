FROM node:20-alpine

WORKDIR /app

# Server has zero external dependencies, using native Node.js http, dgram, and fs
COPY server.js ./
COPY public/ ./public/

EXPOSE 8080

CMD ["node", "server.js"]
