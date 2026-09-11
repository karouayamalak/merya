import { WebSocketServer, WebSocket } from 'ws';
import { parse as parseCookie } from 'cookie';
import jwt from 'jsonwebtoken';
import { Admin } from '../models/Admin.js';
import { Order } from '../models/Order.js';
import { normalizeAlgerianPhone } from '../utils/phone.js';

class WebSocketService {
  constructor() {
    this.wss = null;
    this.orderSubscriptions = new Map(); // orderCode -> Set<WebSocket>
    this.adminClients = new Set();
  }

  init(server, allowedOrigins = []) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this._allowedOrigins = allowedOrigins;

    this.wss.on('connection', async (ws, req) => {
      // ── Origin Validation ────────────────────────────────────────────────────
      // WebSocket connections are NOT protected by CORS. Browsers send the Origin
      // header on WS upgrades; validate it explicitly.
      const isProduction = process.env.NODE_ENV === 'production';
      if (isProduction && this._allowedOrigins.length > 0) {
        const origin = req.headers?.origin || '';
        if (!this._allowedOrigins.includes(origin)) {
          console.warn(`[WebSocket] Rejected connection from unauthorized origin: "${origin}"`);
          ws.close(1008, 'Origin not allowed');
          return;
        }
      }

      ws.isAlive = true;
      ws.subscribedOrders = new Set();
      ws.isAdmin = false;
      // Pre-authenticate admin identity from the upgrade request cookie.
      // This avoids transmitting the JWT in plaintext WebSocket messages.
      ws._adminIdentity = null;
      ws._authPromise = (async () => {
        try {
          const cookieHeader = req.headers?.cookie || '';
          const cookies = parseCookie(cookieHeader);
          const token = cookies.token;
          if (token) {
            const secret = process.env.JWT_SECRET;
            if (secret) {
              const decoded = jwt.verify(token, secret);
              const admin = await Admin.findById(decoded.id).select('-passwordHash');
              const tokenVersion = decoded.sessionVersion !== undefined ? decoded.sessionVersion : 1;
              const currentVersion = admin?.sessionVersion !== undefined ? admin.sessionVersion : 1;
              if (admin && admin.isActive && tokenVersion === currentVersion && (admin.role === 'admin' || admin.role === 'owner')) {
                ws._adminIdentity = admin;
              }
            }
          }
        } catch {
          // Not authenticated as admin — cookie absent, expired, or invalid. This is not an error.
        }
      })();

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws._msgWindowStart = Date.now();
      ws._msgCount = 0;

      ws.on('message', async (data) => {
        const now = Date.now();
        if (now - ws._msgWindowStart > 10000) {
          ws._msgWindowStart = now;
          ws._msgCount = 0;
        }
        ws._msgCount++;
        if (ws._msgCount > 60) {
          console.warn('[WebSocket] Terminating socket due to severe message flooding');
          ws.terminate();
          return;
        }
        if (ws._msgCount > 30) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Rate limit exceeded. Please slow down.' }));
          return;
        }

        try {
          const message = JSON.parse(data.toString());
          await this.handleMessage(ws, message);
        } catch (err) {
          console.error('[WebSocket] Invalid JSON message:', err.message);
        }
      });

      ws.on('close', () => {
        this.cleanupClient(ws);
      });

      ws.on('error', (err) => {
        console.error('[WebSocket] Socket error:', err.message);
        this.cleanupClient(ws);
      });

      // Send initial welcome
      ws.send(JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() }));
    });

    // Heartbeat ping interval every 30 seconds
    const interval = setInterval(() => {
      if (!this.wss) return;
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          this.cleanupClient(ws);
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);

    this.wss.on('close', () => {
      clearInterval(interval);
    });

    console.log('[WebSocket] Server initialized on /ws');
  }


  async handleMessage(ws, message) {
    if (ws._authPromise) {
      await ws._authPromise;
    }

    const { action, orderCode, phone, token } = message;

    // 1. ADMIN SUBSCRIPTION — Authenticated via HttpOnly cookie at connection time
    if (action === 'SUBSCRIBE_ADMIN') {
      const adminIdentity = ws._adminIdentity;
      if (!adminIdentity) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized: Admin session required' }));
        return;
      }

      this.adminClients.add(ws);
      ws.isAdmin = true;
      ws.send(JSON.stringify({ type: 'SUBSCRIBED', channel: 'admin' }));
      return;
    }

    // 2. CUSTOMER ORDER SUBSCRIPTION — Strictly requires verified ownership (Order Code + Exact Matching Phone)
    if (action === 'SUBSCRIBE_ORDER') {
      if (!orderCode || !phone) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Both orderCode and phone number are required to subscribe to order updates' }));
        return;
      }

      const code = String(orderCode).trim().toUpperCase();
      let normalizedPhone;
      try {
        normalizedPhone = normalizeAlgerianPhone(String(phone));
      } catch {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid phone number format' }));
        return;
      }

      const order = await Order.findOne({ orderCode: code });
      if (!order) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Order verification failed' }));
        return;
      }

      let storedPhone;
      try {
        storedPhone = normalizeAlgerianPhone(order.customer.phone);
      } catch {
        storedPhone = order.customer.phone.replace(/[\s-]/g, '');
      }

      if (storedPhone !== normalizedPhone) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Order ownership verification failed' }));
        return;
      }

      if (!this.orderSubscriptions.has(code)) {
        this.orderSubscriptions.set(code, new Set());
      }
      this.orderSubscriptions.get(code).add(ws);
      ws.subscribedOrders.add(code);
      ws.send(JSON.stringify({ type: 'SUBSCRIBED', channel: `order:${code}` }));
      return;
    }
  }

  cleanupClient(ws) {
    if (ws.subscribedOrders) {
      ws.subscribedOrders.forEach((code) => {
        const clients = this.orderSubscriptions.get(code);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            this.orderSubscriptions.delete(code);
          }
        }
      });
    }
    this.adminClients.delete(ws);
  }

  broadcastOrderStatus(orderCode, status, details = {}) {
    const code = orderCode.trim().toUpperCase();
    const payload = JSON.stringify({
      type: 'ORDER_STATUS_UPDATED',
      orderCode: code,
      status,
      details,
      timestamp: new Date().toISOString()
    });

    // Send to customers viewing this order tracking
    const clients = this.orderSubscriptions.get(code);
    if (clients) {
      clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(payload);
          } catch (err) {
            console.warn('[WebSocket] broadcastOrderStatus send error (non-fatal):', err.message);
            this.cleanupClient(ws);
          }
        }
      });
    }

    // Also notify admin clients
    this.adminClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
        } catch (err) {
          console.warn('[WebSocket] broadcastOrderStatus admin send error (non-fatal):', err.message);
          this.cleanupClient(ws);
        }
      }
    });
  }

  broadcastNewOrder(order) {
    const payload = JSON.stringify({
      type: 'NEW_ORDER_RECEIVED',
      order: {
        orderCode: order.orderCode,
        customerName: order.customer.fullName,
        totalPrice: order.totalPrice,
        status: order.status,
        createdAt: order.createdAt
      },
      timestamp: new Date().toISOString()
    });

    this.adminClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
        } catch (err) {
          // Non-fatal: order is already saved. Log and clean up dead socket.
          console.warn('[WebSocket] broadcastNewOrder send error (non-fatal):', err.message);
          this.cleanupClient(ws);
        }
      }
    });
  }

  broadcastOrderUpdate(orderCode, order) {
    const code = orderCode.trim().toUpperCase();
    const payload = JSON.stringify({
      type: 'ORDER_UPDATED',
      orderCode: code,
      status: order.status,
      totalPrice: order.totalPrice,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      itemsCount: order.items?.length || 0,
      timestamp: new Date().toISOString()
    });

    const clients = this.orderSubscriptions.get(code);
    if (clients) {
      clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(payload);
          } catch (err) {
            this.cleanupClient(ws);
          }
        }
      });
    }

    this.adminClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(payload);
        } catch (err) {
          this.cleanupClient(ws);
        }
      }
    });
  }
}

export const wsService = new WebSocketService();
