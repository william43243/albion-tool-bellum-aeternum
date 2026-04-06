FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx expo export --platform web

# Build analytics server dependencies
WORKDIR /analytics
COPY analytics/package.json ./
RUN npm install --omit=dev

# ── Production ──
FROM node:20-alpine

# Install nginx and supervisor
RUN apk add --no-cache nginx supervisor

# Remove default nginx config
RUN rm -f /etc/nginx/http.d/default.conf

# Copy nginx config
COPY nginx.conf /etc/nginx/http.d/albion.conf

# Copy landing page
COPY site/ /usr/share/nginx/html/

# Copy Expo web build
COPY --from=builder /app/dist/ /usr/share/nginx/html/app/

# Copy shared assets (icon, favicon, etc.)
COPY assets/icon.png /usr/share/nginx/html/assets/icon.png
COPY assets/favicon.png /usr/share/nginx/html/assets/favicon.png
COPY assets/icon-192.png /usr/share/nginx/html/assets/icon-192.png

# Copy APK explicitly
COPY android/app/build/outputs/apk/release/app-release.apk /usr/share/nginx/html/downloads/albion-market.apk

# Copy analytics server
COPY analytics/server.js /opt/analytics/server.js
COPY --from=builder /analytics/node_modules/ /opt/analytics/node_modules/

# Create data directory for SQLite
RUN mkdir -p /data

# Supervisor config to run both nginx and analytics
RUN mkdir -p /etc/supervisor.d
COPY supervisord.conf /etc/supervisord.conf

EXPOSE 80

VOLUME ["/data"]

CMD ["supervisord", "-c", "/etc/supervisord.conf"]
