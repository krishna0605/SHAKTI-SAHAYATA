# Build stage
FROM node:20-alpine AS build
WORKDIR /app
ARG BUILD_SCRIPT=build
ARG DIST_DIR=dist
ARG VITE_API_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
COPY frontend/package*.json ./
RUN npm install
COPY frontend/. .
COPY shared /shared
RUN npm run ${BUILD_SCRIPT}

# Production stage
FROM nginx:alpine
ARG DIST_DIR=dist
COPY --from=build /app/${DIST_DIR} /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
