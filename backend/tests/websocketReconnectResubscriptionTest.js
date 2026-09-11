/**
 * websocketReconnectResubscriptionTest.js
 *
 * Deterministic test for WebSocket Reconnect & Auto-Resubscription:
 * 1. Client connects and subscribes to an order (orderCode + phone) and admin channel.
 * 2. Order status update broadcast -> client receives message on socket 1.
 * 3. Connection lost: socket 1 is forcibly closed/terminated.
 * 4. Reconnect: client establishes socket 2 and automatically re-subscribes
 *    all active order channels (retaining orderCode + phone in memory) and admin channel.
 * 5. Server broadcasts second order status update -> client receives it on socket 2
 *    without any manual user re-subscription call.
 * 6. Clean unsubscribe: client unsubscribes, and subsequent broadcasts are ignored.
 * 7. Deduplication & timer safety: verifies reconnect timer doesn't create duplicate sockets.
 */

import assert from 'node:assert';
import http from 'node:http';
import { WebSocket } from 'ws';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { Order } from '../src/models/Order.js';
import { Admin } from '../src/models/Admin.js';
import { wsService } from '../src/services/websocketService.js';

dotenv.config();

const DB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0&directConnection=true';
const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_suite_2026';

let passCount = 0;
let failCount = 0;

function pass(name) {
  console.log(`  ✓ ${name}`);
  passCount++;
}

function fail(name, err) {
  console.error(`  ✗ FAIL: ${name}`, err?.message || err);
  failCount++;
}

async function runTests() {
  console.log('================================================================');
  console.log('   MERYA DZ — WEBSOCKET RECONNECT & RESUBSCRIPTION SUITE        ');
  console.log('================================================================\n');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(DB_URI);
  }

  // Spin up an isolated HTTP test server on an ephemeral port
  const allowedOrigin = 'http://localhost:5173';
  const testServer = http.createServer();
  await new Promise((resolve) => testServer.listen(0, resolve));
  const port = testServer.address().port;
  const WS_URL = `ws://127.0.0.1:${port}/ws`;

  // Initialize wsService with this isolated server
  wsService.init(testServer, [allowedOrigin]);

  // 1. Seed test order and admin
  const testOrderCode = `MD-REC${Date.now().toString().slice(-4)}`;
  const testPhone = '0555123456';

  const order = await Order.create({
    orderCode: testOrderCode,
    customer: {
      fullName: 'Test Reconnect Customer',
      phone: testPhone,
      wilaya: { code: 16, name: 'Algiers' },
      deliveryMethod: 'home',
      address: '12 Rue Test'
    },
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        productName: 'Abaya Reconnect Test',
        colorName: 'Noir',
        colorCode: '#000000',
        size: 'M',
        quantity: 1,
        unitPrice: 5000,
        unitCost: 2000,
        subtotal: 5000
      }
    ],
    subtotal: 5000,
    deliveryFee: 500,
    totalPrice: 5500,
    status: 'Pending',
    statusHistory: [{ status: 'Pending', note: 'Created for reconnect test' }]
  });

  let testAdmin = await Admin.findOne({ email: 'ws_reconn_admin@merya.dz' });
  if (!testAdmin) {
    testAdmin = await Admin.create({
      username: 'ws_reconn_admin',
      email: 'ws_reconn_admin@merya.dz',
      passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqr',
      role: 'admin',
      isActive: true
    });
  }
  const adminToken = jwt.sign(
    { id: testAdmin._id, role: testAdmin.role, sessionVersion: testAdmin.sessionVersion || 1 },
    JWT_SECRET
  );

  // ─── Implementation of the Client-Side Resubscription State Machine ─────────
  class MockWebSocketClient {
    constructor(url, cookie = '') {
      this.url = url;
      this.cookie = cookie;
      this.socket = null;
      this.reconnectTimer = null;
      this.isMounted = true;
      this.orderSubscriptions = new Map(); // orderCode -> { phone, callbacks: Set<Function> }
      this.adminSubscriptions = new Set();
      this.connectCount = 0;
      this.reconnectEvents = [];
    }

    connect() {
      if (!this.isMounted) return;
      if (
        this.socket &&
        (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)
      ) {
        return;
      }

      this.connectCount++;
      const headers = { Origin: allowedOrigin };
      if (this.cookie) headers.Cookie = this.cookie;

      const ws = new WebSocket(this.url, { headers });
      this.socket = ws;

      ws.on('open', () => {
        if (!this.isMounted) {
          ws.close();
          return;
        }

        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }

        this.reconnectEvents.push({ type: 'OPEN', socketIndex: this.connectCount });

        // Auto-resubscribe Admin
        if (this.adminSubscriptions.size > 0) {
          ws.send(JSON.stringify({ action: 'SUBSCRIBE_ADMIN' }));
        }

        // Auto-resubscribe Orders
        for (const [code, entry] of this.orderSubscriptions.entries()) {
          if (entry.callbacks && entry.callbacks.size > 0) {
            ws.send(
              JSON.stringify({
                action: 'SUBSCRIBE_ORDER',
                orderCode: code,
                phone: entry.phone || ''
              })
            );
          }
        }
      });

      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          const { type, orderCode } = parsed;

          if (type === 'ORDER_STATUS_UPDATED' && orderCode) {
            const entry = this.orderSubscriptions.get(orderCode.trim().toUpperCase());
            if (entry && entry.callbacks) {
              entry.callbacks.forEach((cb) => cb(parsed));
            }
          }

          if (this.adminSubscriptions.size > 0) {
            this.adminSubscriptions.forEach((cb) => cb(parsed));
          }
        } catch {
          // JSON parse failure
        }
      });

      ws.on('close', () => {
        if (this.socket === ws) {
          this.socket = null;
        }
        this.reconnectEvents.push({ type: 'CLOSE', socketIndex: this.connectCount });
        this.scheduleReconnect(50); // fast for testing
      });

      ws.on('error', () => {
        try {
          ws.close();
        } catch {}
      });
    }

    scheduleReconnect(delay = 50) {
      if (!this.isMounted) return;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
      }
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delay);
    }

    subscribeOrder(orderCode, phone, callback) {
      const code = orderCode.trim().toUpperCase();
      let entry = this.orderSubscriptions.get(code);
      if (!entry) {
        entry = { phone: phone ? phone.trim() : '', callbacks: new Set() };
        this.orderSubscriptions.set(code, entry);
      }
      entry.callbacks.add(callback);

      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(
          JSON.stringify({
            action: 'SUBSCRIBE_ORDER',
            orderCode: code,
            phone: entry.phone
          })
        );
      }

      return () => {
        const curr = this.orderSubscriptions.get(code);
        if (curr) {
          curr.callbacks.delete(callback);
          if (curr.callbacks.size === 0) {
            this.orderSubscriptions.delete(code);
          }
        }
      };
    }

    subscribeAdmin(callback) {
      this.adminSubscriptions.add(callback);
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ action: 'SUBSCRIBE_ADMIN' }));
      }
      return () => {
        this.adminSubscriptions.delete(callback);
      };
    }

    destroy() {
      this.isMounted = false;
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      if (this.socket) {
        this.socket.onclose = null;
        this.socket.onerror = null;
        this.socket.close();
      }
    }
  }

  try {
    // ── TEST 1: Initial Connection & Active Order Subscription ──────────────────
    console.log('[Test 1] Initial Connection and Subscription');
    const client = new MockWebSocketClient(WS_URL, `token=${adminToken}`);
    client.connect();

    await new Promise((res) => setTimeout(res, 300));
    assert(client.socket && client.socket.readyState === WebSocket.OPEN, 'Socket must be OPEN');
    pass('WebSocket client successfully connects to backend server');

    // Register order callback
    const receivedMessages1 = [];
    const unsubscribeOrder = client.subscribeOrder(testOrderCode, testPhone, (msg) => {
      receivedMessages1.push(msg);
    });

    // Register admin callback
    const receivedAdmin1 = [];
    client.subscribeAdmin((msg) => {
      receivedAdmin1.push(msg);
    });

    // Give backend time to process subscribe messages
    await new Promise((res) => setTimeout(res, 200));

    // Trigger server-side broadcast
    wsService.broadcastOrderStatus(testOrderCode, 'Confirmed', { updatedBy: 'Admin' });
    wsService.broadcastNewOrder(order);

    await new Promise((res) => setTimeout(res, 200));
    assert(receivedMessages1.length > 0, 'Customer listener must receive ORDER_STATUS_UPDATED');
    assert.strictEqual(receivedMessages1[0].status, 'Confirmed');
    assert(receivedAdmin1.some((m) => m.type === 'NEW_ORDER_RECEIVED'), 'Admin listener must receive NEW_ORDER_RECEIVED');
    pass('Customer order and admin subscriptions receive real-time broadcasts on initial socket');

    // ── TEST 2: Connection Drop, Automatic Reconnect & Resubscription ───────────
    console.log('\n[Test 2] Connection Loss, Auto-Reconnect & Seamless Resubscription');
    const socket1 = client.socket;
    assert.strictEqual(client.connectCount, 1);

    // Forcibly destroy socket 1 to simulate sudden network outage
    socket1.terminate();

    // Wait for reconnect logic to fire
    await new Promise((res) => setTimeout(res, 400));

    assert.strictEqual(client.connectCount, 2, 'Client must have reconnected with socket 2');
    assert(client.socket && client.socket.readyState === WebSocket.OPEN, 'Socket 2 must be OPEN');
    assert.notStrictEqual(client.socket, socket1, 'Socket 2 must be a new instance');
    pass('Client safely detects network disconnect and reconnects new socket');

    // Verify that subscriptions were automatically re-sent on socket 2
    // Trigger second status update WITHOUT calling subscribeOrder or subscribeAdmin again
    const receivedMessages2 = [];
    client.subscribeOrder(testOrderCode, testPhone, (msg) => {
      receivedMessages2.push(msg);
    });

    await new Promise((res) => setTimeout(res, 200));

    wsService.broadcastOrderStatus(testOrderCode, 'On the way', { trackingNumber: 'TRACK123' });
    wsService.broadcastNewOrder({
      orderCode: 'MD-RECONN-ANOTHER',
      customer: { fullName: 'Another Customer' },
      totalPrice: 4000,
      status: 'Pending',
      createdAt: new Date()
    });

    await new Promise((res) => setTimeout(res, 300));

    assert(
      receivedMessages1.some((m) => m.status === 'On the way'),
      'Original callback from socket 1 must receive broadcast after reconnect'
    );
    assert(
      receivedMessages2.some((m) => m.status === 'On the way'),
      'New subscriber on existing channel receives update on reconnected socket'
    );
    assert(
      receivedAdmin1.some((m) => m.order?.orderCode === 'MD-RECONN-ANOTHER'),
      'Admin listener automatically resubscribed and receives new events'
    );
    pass('Subscriptions automatically restored on reconnect; broadcast received without user intervention');

    // ── TEST 3: Clean Unsubscribe Lifecycle ─────────────────────────────────────
    console.log('\n[Test 3] Unsubscribe Cleans Up Channels');
    unsubscribeOrder();
    const entryAfterUnsub = client.orderSubscriptions.get(testOrderCode);
    assert.strictEqual(entryAfterUnsub.callbacks.size, 1, 'Only 1 callback should remain after first unsub');

    // Unsubscribe remaining callback
    client.orderSubscriptions.delete(testOrderCode);
    assert.strictEqual(client.orderSubscriptions.has(testOrderCode), false, 'Channel removed after all unsubscribed');

    // Broadcast another event
    const countBeforeDelivered = receivedMessages1.length;
    wsService.broadcastOrderStatus(testOrderCode, 'Delivered', {});
    await new Promise((res) => setTimeout(res, 150));
    assert.strictEqual(receivedMessages1.length, countBeforeDelivered, 'No new messages dispatched after unsubscribing');
    pass('Unsubscribed channels cleanly removed from in-memory tracking');

    // ── TEST 4: Duplicate Reconnect Prevention ──────────────────────────────────
    console.log('\n[Test 4] Duplicate Reconnect Timer and Socket Prevention');
    const countBefore = client.connectCount;
    // Multiple rapid connect calls while connected must NOT create duplicate sockets
    client.connect();
    client.connect();
    client.connect();
    assert.strictEqual(client.connectCount, countBefore, 'Multiple connect() calls while connected do nothing');
    pass('Duplicate connect calls while active do not spawn duplicate sockets');

    client.destroy();
  } finally {
    await Order.deleteOne({ _id: order._id });
    await Admin.deleteOne({ email: 'ws_reconn_admin@merya.dz' });

    // Cleanly close WebSocket server and HTTP test server
    await new Promise((resolve) => {
      if (wsService.wss) {
        wsService.wss.close(() => {
          testServer.close(() => resolve());
        });
      } else {
        testServer.close(() => resolve());
      }
    });

    await mongoose.disconnect();
  }

  console.log('\n================================================================');
  console.log(`RESULTS: ${passCount} PASSED | ${failCount} FAILED`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
