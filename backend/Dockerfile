FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Copy file khai báo thư viện trước để Docker cache lại bước cài đặt khi chỉ sửa code
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./

# Không chạy ứng dụng bằng tài khoản root
USER node

# Cổng nội bộ: chỉ Nginx gọi tới qua mạng Docker, không mở ra Internet
EXPOSE 5000
CMD ["node", "server.js"]
