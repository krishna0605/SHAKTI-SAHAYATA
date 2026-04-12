FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/. .
COPY shared /shared
EXPOSE 3001
CMD ["node", "index.js"]
