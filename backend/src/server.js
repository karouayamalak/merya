import http from 'http';
import path from 'path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

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
import gameRoutes from './routes/gameRoutes.js';
import bannerRoutes from './routes/bannerRoutes.js';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

// Strict Production Preflight Checks — Fails fast if security keys or configurations are missing
if (process.env.NODE_ENV === 'production') {
  const missingCriticalEnv = [];
  if (!process.env.JWT_SECRET) missingCriticalEnv.push('JWT_SECRET');
  if (!process.env.COOKIE_SECRET) missingCriticalEnv.push('COOKIE_SECRET');
  if (!process.env.MONGODB_URI) missingCriticalEnv.push('MONGODB_URI');
  if (!process.env.CLIENT_ORIGIN) missingCriticalEnv.push('CLIENT_ORIGIN');

  if (missingCriticalEnv.length > 0) {
    console.error(`[MERYA DZ FATAL ERROR] Missing critical production environment variables: ${missingCriticalEnv.join(', ')}`);
    console.error('[MERYA DZ FATAL ERROR] The server has aborted startup safely to prevent insecure execution.');
    process.exit(1);
  }
}

const app = express();
const server = http.createServer(app);

// Render / Reverse Proxy Trust Setting
// Render sits behind an edge reverse proxy load balancer (1 hop).
// Setting 'trust proxy' to 1 enables Express and express-rate-limit to read
// the real client IP from the right-most X-Forwarded-For header without risking
// spoofing attacks from untrusted upstream headers.
if (process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY) {
  app.set('trust proxy', 1);
}

// Connect to Database
connectDB();

// Security Headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' } // Allows frontend to render uploaded images
}));

// CORS Setup — production strictly limits to CLIENT_ORIGIN; dev adds localhost for hot-reload
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = isProduction
  ? [process.env.CLIENT_ORIGIN].filter(Boolean)
  : [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      process.env.CLIENT_ORIGIN
    ].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow same-origin (no origin header) and explicitly whitelisted origins
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

const cookieSecret = process.env.COOKIE_SECRET || (process.env.NODE_ENV === 'production' ? null : 'merya_dev_cookie_secret_2026');
app.use(cookieParser(cookieSecret));

// Production-Safe HTTP Logger — Never logs authorization headers, cookies, passwords, or customer PII
if (process.env.NODE_ENV === 'production') {
  app.use(morgan(':date[iso] :remote-addr :method :url :status :res[content-length] - :response-time ms', {
    skip: (req) => req.url === '/health'
  }));
} else if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Serve uploaded static files
const uploadsPath = path.resolve('uploads');
app.use('/uploads', express.static(uploadsPath));

// Health Check Endpoint (Liveness)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'MERYA DZ E-Commerce API',
    uptime: process.uptime()
  });
});

// Readiness Check Endpoint (Database Connectivity)
// Verifies MongoDB replica set connection and responsiveness separately from process liveness
app.get(['/ready', '/health/ready'], async (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  if (!isConnected) {
    return res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: 'MongoDB connection is not established'
    });
  }

  try {
    await mongoose.connection.db.admin().ping();
    res.json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      database: 'connected',
      service: 'MERYA DZ E-Commerce API',
      uptime: process.uptime()
    });
  } catch (err) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      database: 'unresponsive',
      error: err.message
    });
  }
});

// Apply API rate limiting
app.use('/api', apiLimiter);

// HTTP Caching Policy Middleware:
// - Private & mutating endpoints: completely uncacheable (no-store, no-cache, must-revalidate, private)
// - Public storefront GET catalog endpoints (categories, products, delivery settings): safe short-term cache (30s)
app.use('/api', (req, res, next) => {
  const method = req.method.toUpperCase();
  const url = req.originalUrl.toLowerCase();

  if (
    method !== 'GET' ||
    url.includes('/admin') ||
    url.includes('/auth') ||
    url.includes('/orders') ||
    url.includes('/analytics') ||
    url.includes('/tracking') ||
    url.includes('/upload')
  ) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  } else {
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  }
  next();
});

// CSRF protection is applied per-route in admin route files (see orderRoutes, productRoutes, etc.)
// Public mutation endpoints (checkout, tracking, login) bypass CSRF intentionally:
//   - they carry no admin cookie, so CSRF is not the threat vector
//   - verifyCsrf is injected alongside authenticateAdmin on all admin mutation routes

// Mount API Routes under /api/v1
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/tracking', trackingRoutes);
app.use('/api/v1/settings', settingRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/upload', uploadRoutes);
app.use('/api/v1/games', gameRoutes);
app.use('/api/v1/banners', bannerRoutes);

// Centralized Error Handling
app.use(errorHandler);

// Initialize WebSockets on HTTP server — pass allowed origins for Origin validation
wsService.init(server, allowedOrigins);

const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`[MERYA DZ Server] Running on http://localhost:${PORT}`);
    console.log(`[MERYA DZ Server] WebSocket endpoint active at ws://localhost:${PORT}/ws`);
  });
}

export { app, server };
