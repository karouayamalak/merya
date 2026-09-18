import { WebSocketServer, WebSocket } from 'ws';
import { parse as parseCookie } from 'cookie';
import { Admin } from '../models/Admin.js';
import { Session } from '../models/Session.js';
import { Order } from '../models/Order.js';
import { normalizeAlgerianPhone } from '../utils/phone.js';
import { verifyAccessToken } from '../utils/tokenUtils.js';

class WebSocketService {
  constructor() {
    this.wss = null;
    this.orderSubscriptions = new Map(); // orderCode -> Set<WebSocket>
    this.adminClients = new Set();
    // IP → count of active connections (decremented on close)
    this._ipConnectionCount = new Map();
    // IP → { count, windowStart } for handshake rate limiting (sliding window)
    this._ipHandshakeWindow = new Map();
  }

  init(server, allowedOrigins = []) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this._allowedOrigins = allowedOrigins;

    // Constants
    this.MAX_CONNECTIONS_PER_IP = 10;
    this.MAX_HANDSHAKES_PER_IP_PER_MINUTE = 20;
    this.MAX_TOTAL_CONNECTIONS = 500;
    this.IDLE_SUBSCRIBE_TIMEOUT_MS = 30000; // 30s to subscribe or disconnect

    this.wss.on('connection', async (ws, req) => {
      // ── Global server-wide capacity guard ────────────────────────────────────
      // When ws connects, wss.clients already includes ws.
      // Existing connections prior to this incoming client is:
      const existingConnections = this.wss.clients.has(ws)
        ? this.wss.clients.size - 1
        : this.wss.clients.size;
      if (existingConnections >= this.MAX_TOTAL_CONNECTIONS) {
        console.warn('[WebSocket] Global connection cap reached. Rejecting new connection.');
        ws.close(1013, 'Server at capacity');
        return;
      }

      // ── Extract connecting IP (respecting trusted proxy topology) ──────────────
      const ip = this._extractClientIp(req);

      // ── IP-level handshake rate limiting (20 new connections per minute per IP) ─
      const now = Date.now();
      const hWindow = this._ipHandshakeWindow.get(ip) || { count: 0, windowStart: now };
      if (now - hWindow.windowStart > 60000) {
        hWindow.count = 1;
        hWindow.windowStart = now;
      } else {
        hWindow.count++;
      }
      this._ipHandshakeWindow.set(ip, hWindow);
      if (hWindow.count > this.MAX_HANDSHAKES_PER_IP_PER_MINUTE) {
        console.warn(`[WebSocket] IP ${ip} exceeded handshake rate limit (${hWindow.count}/min). Rejecting.`);
        ws.close(1008, 'Handshake rate limit exceeded');
        return;
      }

      // ── Per-IP concurrent connection cap ─────────────────────────────────────
      const currentIpCount = (this._ipConnectionCount.get(ip) || 0) + 1;
      this._ipConnectionCount.set(ip, currentIpCount);
      ws._remoteIp = ip;
      if (currentIpCount > this.MAX_CONNECTIONS_PER_IP) {
        console.warn(`[WebSocket] IP ${ip} exceeded per-IP connection limit (${currentIpCount}). Rejecting.`);
        ws.close(1008, 'Too many connections from this IP');
        this._decrementIpCount(ip);
        return;
      }

      // ── Origin Validation ────────────────────────────────────────────────────
      // WebSocket connections are NOT protected by CORS. Browsers send the Origin
      // header on WS upgrades; validate it explicitly.
      const isProduction = process.env.NODE_ENV === 'production';
      if (isProduction && this._allowedOrigins.length > 0) {
        const origin = req.headers?.origin || '';
        if (!this._allowedOrigins.includes(origin)) {
          console.warn(`[WebSocket] Rejected connection from unauthorized origin: "${origin}"`);
          ws.close(1008, 'Origin not allowed');
          this._decrementIpCount(ip);
          return;
        }
      }

      ws.isAlive = true;
      ws.subscribedOrders = new Set();
      ws.isAdmin = false;
      ws._hasSubscribed = false; // track whether the client has subscribed to anything
      // Pre-authenticate admin identity from the upgrade request cookie.
      // This avoids transmitting the JWT in plaintext WebSocket messages.
      ws._adminIdentity = null;
      ws._sessionId = null;
      ws._adminId = null;
      ws._authPromise = (async () => {
        try {
          const cookieHeader = req.headers?.cookie || '';
          const cookies = parseCookie(cookieHeader);
          const accessToken = cookies.accessToken;
          if (accessToken) {
            const decoded = verifyAccessToken(accessToken);
            if (decoded && decoded.type === 'access' && decoded.sid && decoded.sub) {
              const [session, admin] = await Promise.all([
                Session.findById(decoded.sid).lean(),
                Admin.findById(decoded.sub).select('-passwordHash')
              ]);

              if (
                session &&
                !session.revokedAt &&
                (!session.expiresAt || session.expiresAt > new Date()) &&
                String(session.adminId) === decoded.sub &&
                admin &&
                admin.isActive &&
                (admin.role === 'admin' || admin.role === 'owner')
              ) {
                ws._adminIdentity = admin;
                ws._adminId = admin._id.toString();
                ws._sessionId = session._id.toString();
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
        this._decrementIpCount(ws._remoteIp);
        this.cleanupClient(ws);
      });

      ws.on('error', (err) => {
        console.error('[WebSocket] Socket error:', err.message);
        this._decrementIpCount(ws._remoteIp);
        this.cleanupClient(ws);
      });

      // ── Idle subscription timeout (30s) ───────────────────────────────────────
      // If the client connects but does not send a SUBSCRIBE_ADMIN or SUBSCRIBE_ORDER
      // within 30 seconds, close the connection to prevent idle resource exhaustion.
      const idleTimer = setTimeout(() => {
        if (!ws._hasSubscribed && ws.readyState === WebSocket.OPEN) {
          console.warn(`[WebSocket] Closing idle unsubscribed socket from IP ${ip}`);
          ws.close(4000, 'Idle timeout: no subscription received within 30 seconds');
        }
      }, this.IDLE_SUBSCRIBE_TIMEOUT_MS);
      ws._idleTimer = idleTimer;

      // Send initial welcome
      ws.send(JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() }));
    });


    // Heartbeat ping interval every 30 seconds & active admin session verification
    const interval = setInterval(async () => {
      if (!this.wss) return;
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          this.cleanupClient(ws);
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });

      // Periodically verify that all active admin sockets still have a valid, unrevoked session
      for (const ws of Array.from(this.adminClients)) {
        const isValid = await this.validateAdminSocket(ws);
        if (!isValid) {
          try {
            ws.send(JSON.stringify({ type: 'SESSION_REVOKED', message: 'Admin session has been revoked or logged out.' }));
            ws.close(4001, 'Session revoked');
          } catch {
            ws.terminate();
          }
          this.cleanupClient(ws);
        }
      }

      // Periodically purge stale handshake rate-limiting entries (older than 2 minutes)
      const now = Date.now();
      for (const [ipKey, hData] of this._ipHandshakeWindow.entries()) {
        if (now - hData.windowStart > 120000) {
          this._ipHandshakeWindow.delete(ipKey);
        }
      }
    }, 30000);

    this.wss.on('close', () => {
      clearInterval(interval);
    });

    console.log('[WebSocket] Server initialized on /ws');
  }

  /** Extract client IP adhering to reverse-proxy trust configuration */
  _extractClientIp(req) {
    const isProxyTrusted = process.env.NODE_ENV === 'production' || Boolean(process.env.TRUST_PROXY);
    if (isProxyTrusted && req.headers && req.headers['x-forwarded-for']) {
      const forwarded = String(req.headers['x-forwarded-for']);
      const firstIp = forwarded.split(',')[0].trim();
      if (firstIp) return firstIp;
    }
    return req.socket?.remoteAddress || 'unknown';
  }

  /** Decrement per-IP connection count safely */
  _decrementIpCount(ip) {
    if (!ip) return;
    const current = this._ipConnectionCount?.get(ip) || 0;
    if (current <= 1) {
      this._ipConnectionCount?.delete(ip);
    } else {
      this._ipConnectionCount?.set(ip, current - 1);
    }
  }

  async validateAdminSocket(ws) {
    if (!ws || !ws._adminId || !ws._sessionId) return false;
    try {
      const [session, admin] = await Promise.all([
        Session.findById(ws._sessionId).lean(),
        Admin.findById(ws._adminId).select('isActive role')
      ]);

      if (!session || session.revokedAt || (session.expiresAt && session.expiresAt <= new Date())) {
        return false;
      }
      if (!admin || !admin.isActive || (admin.role !== 'admin' && admin.role !== 'owner')) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  revokeAdminSession(sessionId) {
    if (!sessionId) return;
    const sidStr = String(sessionId);
    this.adminClients.forEach((ws) => {
      if (ws._sessionId === sidStr) {
        try {
          ws.send(JSON.stringify({ type: 'SESSION_REVOKED', message: 'Admin session has been revoked or logged out.' }));
          ws.close(4001, 'Session revoked');
        } catch {
          ws.terminate();
        }
        this.cleanupClient(ws);
      }
    });
  }

  revokeAdminAllSessions(adminId) {
    if (!adminId) return;
    const idStr = String(adminId);
    this.adminClients.forEach((ws) => {
      if (ws._adminId === idStr) {
        try {
          ws.send(JSON.stringify({ type: 'SESSION_REVOKED', message: 'All admin sessions have been revoked.' }));
          ws.close(4001, 'Session revoked');
        } catch {
          ws.terminate();
        }
        this.cleanupClient(ws);
      }
    });
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

      // Live database verification to ensure session was not revoked between connect and subscribe
      const isValid = await this.validateAdminSocket(ws);
      if (!isValid) {
        ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized: Admin session required' }));
        return;
      }

      this.adminClients.add(ws);
      ws.isAdmin = true;
      // Mark as subscribed and clear idle timer
      ws._hasSubscribed = true;
      if (ws._idleTimer) { clearTimeout(ws._idleTimer); ws._idleTimer = null; }
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
      // Mark as subscribed and clear idle timer
      ws._hasSubscribed = true;
      if (ws._idleTimer) { clearTimeout(ws._idleTimer); ws._idleTimer = null; }
      ws.send(JSON.stringify({ type: 'SUBSCRIBED', channel: `order:${code}` }));
      return;
    }
  }

  cleanupClient(ws) {
    // Clear idle timer if still pending
    if (ws._idleTimer) { clearTimeout(ws._idleTimer); ws._idleTimer = null; }
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
