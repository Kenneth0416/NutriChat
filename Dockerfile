FROM node:20-slim AS backend-builder

WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm install --production

COPY backend/ .

# -----------------------

FROM node:20-slim

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=backend-builder /app/backend /app/backend
COPY frontend /app/frontend

RUN apt-get update \
  && apt-get install -y nginx \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /var/www/nutrichat

RUN cp -r /app/frontend/* /var/www/nutrichat/ \
  && rm -f /etc/nginx/conf.d/default.conf \
  && rm -f /etc/nginx/sites-enabled/default

COPY docker/nginx.conf /etc/nginx/conf.d/default-site.conf
COPY docker/start.sh /start.sh

RUN chmod +x /start.sh

EXPOSE 80 3000

CMD ["/start.sh"]

