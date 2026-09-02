# Portal hospedado do IPTV Manager (API-only; a UI é o app/APK do Manager
# apontando para este endereço + token). Estado fica no Supabase, então o
# container não precisa de disco persistente.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# A maioria dos hosts injeta PORT; 3001 é só o default/local.
EXPOSE 3001
CMD ["node", "dist/server.js"]
