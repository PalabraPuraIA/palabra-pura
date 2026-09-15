FROM node:22-alpine

WORKDIR /srv

COPY server/package.json ./
RUN npm install --omit=dev

COPY server/index.js server/conversation-store.js server/excerpt.js server/chat.js server/chat-search.js server/chat-llm.js server/chat-guard.js server/bible-versions.js server/life-areas.js ./
COPY app/ ./public/

ENV PORT=80
ENV PUBLIC_DIR=/srv/public
ENV DATA_DIR=/data

RUN mkdir -p /data

EXPOSE 80

CMD ["node", "index.js"]
