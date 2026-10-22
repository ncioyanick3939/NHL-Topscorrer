# NHL Topscorer: runs on any Docker host (Railway, Fly.io, Render, own server).
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    COOKIE_SECURE=1 \
    TRUST_PROXY=1 \
    TZ=Europe/Zurich
# /data must be a persistent volume: the database and the invite code live there.
VOLUME /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
