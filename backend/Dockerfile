# Sử dụng Node.js bản nhẹ Alpine
FROM node:16-alpine
WORKDIR /app
# Sao chép package.json trước để tận dụng Docker Cache layer
COPY package*.json ./
RUN npm install --omit=dev
# Sao chép toàn bộ mã nguồn vào container
COPY . .
# Backend lắng nghe cổng nội bộ 5000 (không mở trực tiếp ra ngoài Internet)
EXPOSE 5000
CMD ["node", "server.js"]