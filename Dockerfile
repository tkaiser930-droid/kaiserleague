# Dockerfile for deploying Kaiser Family Fantasy SMX on Render's Docker runtime.
FROM node:22-alpine

WORKDIR /app

# Copy package metadata first for predictable dependency installation.
COPY package.json ./
RUN npm install --omit=dev

# Copy the site and Node server.
COPY . .

# Render supplies PORT at runtime. The application binds to 0.0.0.0.
ENV HOST=0.0.0.0
ENV DATA_DIR=/var/data
EXPOSE 10000

CMD ["npm", "start"]
