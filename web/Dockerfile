FROM node:22-alpine

WORKDIR /srv

RUN apk add --no-cache ffmpeg python3 py3-pip \
  && pip3 install --break-system-packages --no-cache-dir yt-dlp \
  && mkdir -p /data/ingest /data/ingest-tmp

COPY server/package.json ./
RUN npm install --omit=dev

COPY server/index.js server/conversation-store.js server/excerpt.js server/chat.js server/chat-retrieve.js server/chat-context.js server/chat-search.js server/chat-llm.js server/chat-guard.js server/bible-versions.js server/life-areas.js server/knowledge.js server/knowledge-admin.js server/ingest.js ./
COPY app/ ./public/

ENV PORT=80
ENV PUBLIC_DIR=/srv/public
ENV DATA_DIR=/data
ENV INGEST_DIR=/data/ingest
ENV YT_DLP_PATH=yt-dlp

EXPOSE 80

CMD ["node", "index.js"]
