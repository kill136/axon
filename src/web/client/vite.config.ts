import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// 自动检测后端是否启用 HTTPS（与 server/index.ts 保持一致）
// server/index.ts 用 process.cwd()/.axon-certs，__dirname 回退到项目根目录
const certDir = fs.existsSync(path.join(process.cwd(), '.axon-certs'))
  ? path.join(process.cwd(), '.axon-certs')
  : path.resolve(__dirname, '../../../.axon-certs');
const backendHttps = fs.existsSync(path.join(certDir, 'cert.pem')) && fs.existsSync(path.join(certDir, 'key.pem'));
const backendProto = backendHttps ? 'https' : 'http';
const backendWsProto = backendHttps ? 'wss' : 'ws';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 3457,
    allowedHosts: 'all',
    proxy: {
      '/api': {
        target: `${backendProto}://localhost:3456`,
        changeOrigin: true,
        secure: false, // 允许自签名证书
      },
      '/ws': {
        target: `${backendWsProto}://localhost:3456`,
        ws: true,
        secure: false,
      },
    },
    fs: {
      // 允许访问 client 目录外的 shared 目录
      allow: [
        path.resolve(__dirname, '..'),
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
});
