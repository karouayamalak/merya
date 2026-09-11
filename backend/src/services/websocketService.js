import { WebSocketServer, WebSocket } from 'ws';
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

  init(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      ws.isAlive = true;
      ws.subscribedOrders = new Set();
      ws.isAdmin = false;

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', async (data) => {
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
    const { action, orderCode, phone, token } = message;

    // 1. ADMIN SUBSCRIPTION — Strictly requires valid Admin/Owner JWT token
    if (action === 'SUBSCRIBE_ADMIN') {
      if (!token) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized: Admin authentication token required' }));
        return;
      }

      try {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Server authentication configuration error' }));
          return;
        }

        const decoded = jwt.verify(token, secret);
        const admin = await Admin.findById(decoded.id).select('-passwordHash');

        if (!admin || !admin.isActive || (admin.role !== 'admin' && admin.role !== 'owner')) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Forbidden: Insufficient privileges for admin subscription' }));
          return;
        }

        this.adminClients.add(ws);
        ws.isAdmin = true;
        ws.send(JSON.stringify({ type: 'SUBSCRIBED', channel: 'admin' }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized: Invalid or expired session token' }));
      }
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
}

export const wsService = new WebSocketService();
