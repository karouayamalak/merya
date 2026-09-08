import http from 'http';
import path from 'path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import dotenv from 'dotenv';

import { connectDB } from './config/db.js';
import { wsService } from './services/websocketService.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimiter.js';

import authRoutes from './routes/authRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import productRoutes from './routes/productRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import trackingRoutes from './routes/trackingRoutes.js';
import settingRoutes from './routes/settingRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

// Connect to Database
connectDB();

// Security Headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' } // Allows frontend to render uploaded images
}));

// CORS Setup
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  process.env.CLIENT_ORIGIN
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS policy'));
    }
  },
  credentials: true
}));

// Request Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET || 'merya_cookie_secret_994182419_secure'));

// HTTP Logger
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Serve uploaded static files
const uploadsPath = path.resolve('uploads');
app.use('/uploads', express.static(uploadsPath));

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'MERYA DZ E-Commerce API',
    uptime: process.uptime()
  });
});

// Apply API rate limiting
app.use('/api', apiLimiter);

// Mount API Routes under /api/v1
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/tracking', trackingRoutes);
app.use('/api/v1/settings', settingRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/upload', uploadRoutes);

// Centralized Error Handling
app.use(errorHandler);

// Initialize WebSockets on HTTP server
wsService.init(server);

const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`[MERYA DZ Server] Running on http://localhost:${PORT}`);
    console.log(`[MERYA DZ Server] WebSocket endpoint active at ws://localhost:${PORT}/ws`);
  });
}

export { app, server };
