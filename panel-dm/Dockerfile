FROM node:22-bullseye-slim

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .

ENV PORT=8099
EXPOSE 8099

CMD ["node", "index.js"]
