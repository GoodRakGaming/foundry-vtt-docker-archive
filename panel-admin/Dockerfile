FROM node:22-bullseye-slim

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .

ENV PORT=8100
ENV UPLOAD_DIR_LOCAL=/uploads
ENV UPLOAD_DIR_HOST=/opt/foundry/_uploads
EXPOSE 8100

CMD ["node", "index.js"]
