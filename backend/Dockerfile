FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* .npmrc* ./
RUN npm ci --no-audit --no-fund
COPY src ./src
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["node", "src/index.js"]