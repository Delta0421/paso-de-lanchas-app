# Imagen de DESARROLLO de la app (no se usa en producción: Vercel construye la app por su cuenta).
# Misma versión de Node que .node-version.
FROM node:24-alpine

# openssl lo necesita Prisma; libc6-compat lo necesitan algunos paquetes nativos en Alpine.
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000
