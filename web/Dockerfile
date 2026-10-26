# Build the static frontend, then serve it with nginx with SPA fallback.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_DATA_MODE=demo
ARG VITE_API_BASE_URL=
ARG VITE_DEMO_SCENARIO_SEED=42
ENV VITE_DATA_MODE=$VITE_DATA_MODE VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_DEMO_SCENARIO_SEED=$VITE_DEMO_SCENARIO_SEED
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / { try_files $uri $uri/ /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
