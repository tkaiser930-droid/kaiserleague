# Dockerfile for the Node.js website service. League data is persisted only in GitHub.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV HOST=0.0.0.0
EXPOSE 10000

CMD ["npm", "start"]
