# Build stage
FROM node:20-alpine AS build
WORKDIR /app
ARG BUILD_SCRIPT=build
ARG DIST_DIR=dist
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run ${BUILD_SCRIPT}

# Production stage
FROM nginx:alpine
ARG DIST_DIR=dist
COPY --from=build /app/${DIST_DIR} /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
