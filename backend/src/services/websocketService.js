import { WebSocketServer, WebSocket } from 'ws';

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

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
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

  handleMessage(ws, message) {
    const { action, orderCode, role } = message;

    if (action === 'SUBSCRIBE_ORDER' && orderCode) {
      const code = orderCode.trim().toUpperCase();
      if (!this.orderSubscriptions.has(code)) {
        this.orderSubscriptions.set(code, new Set());
      }
      this.orderSubscriptions.get(code).add(ws);
      ws.subscribedOrders.add(code);
      ws.send(JSON.stringify({ type: 'SUBSCRIBED', channel: `order:${code}` }));
    }

    if (action === 'SUBSCRIBE_ADMIN') {
      this.adminClients.add(ws);
      ws.isAdmin = true;
      ws.send(JSON.stringify({ type: 'SUBSCRIBED', channel: 'admin' }));
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
          ws.send(payload);
        }
      });
    }

    // Also notify admin clients
    this.adminClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
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
        ws.send(payload);
      }
    });
  }
}

export const wsService = new WebSocketService();
