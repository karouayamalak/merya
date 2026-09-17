import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

const WebSocketContext = createContext();

export function WebSocketProvider({ children }) {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const isMountedRef = useRef(true);

  // Active in-memory subscriptions:
  // orderSubscriptionsRef: Map<orderCode, { phone: string, callbacks: Set<Function> }>
  // adminSubscriptionsRef: Set<Function>
  const orderSubscriptionsRef = useRef(new Map());
  const adminSubscriptionsRef = useRef(new Set());

  const getWsUrl = () => {
    let wsUrl = import.meta.env.VITE_WS_URL;
    if (!wsUrl) {
      if (import.meta.env.VITE_BACKEND_URL) {
        const backend = import.meta.env.VITE_BACKEND_URL.replace(/^http/, 'ws');
        wsUrl = `${backend}/ws`;
      } else {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        wsUrl = `${protocol}//${host}/ws`;
      }
    }
    return wsUrl;
  };

  const scheduleReconnect = (delay = 3000) => {
    if (!isMountedRef.current) return;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (!isMountedRef.current) return;

    // Prevent duplicate sockets if one is already connecting or open
    if (
      socketRef.current &&
      (socketRef.current.readyState === WebSocket.CONNECTING ||
        socketRef.current.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    // Clean up any stale closed socket instance
    if (socketRef.current) {
      socketRef.current.onopen = null;
      socketRef.current.onmessage = null;
      socketRef.current.onclose = null;
      socketRef.current.onerror = null;
      socketRef.current = null;
    }

    try {
      const wsUrl = getWsUrl();
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) {
          ws.close();
          return;
        }

        setIsConnected(true);
        console.log('[WebSocket Client] Connected to', wsUrl);

        // Clear any pending reconnect timers
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }

        // Automatic Re-Subscription on Reconnect:
        // 1. Resubscribe admin channel if active
        if (adminSubscriptionsRef.current.size > 0) {
          try {
            ws.send(JSON.stringify({ action: 'SUBSCRIBE_ADMIN' }));
          } catch (err) {
            console.error('[WebSocket] Failed to resubscribe admin:', err);
          }
        }

        // 2. Resubscribe all active order channels with retained orderCode + phone
        for (const [code, entry] of orderSubscriptionsRef.current.entries()) {
          if (entry.callbacks && entry.callbacks.size > 0) {
            try {
              ws.send(
                JSON.stringify({
                  action: 'SUBSCRIBE_ORDER',
                  orderCode: code,
                  phone: entry.phone || ''
                })
              );
            } catch (err) {
              console.error(`[WebSocket] Failed to resubscribe order ${code}:`, err);
            }
          }
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const { type, orderCode } = data;

          // Dispatch to order subscribers
          if (type === 'ORDER_STATUS_UPDATED' && orderCode) {
            const code = String(orderCode).trim().toUpperCase();
            const entry = orderSubscriptionsRef.current.get(code);
            if (entry && entry.callbacks) {
              entry.callbacks.forEach((cb) => {
                try {
                  cb(data);
                } catch (cbErr) {
                  console.error('[WebSocket] Order callback error:', cbErr);
                }
              });
            }
          }

          // Handle session revocation explicitly
          if (type === 'SESSION_REVOKED') {
            console.warn('[WebSocket] Admin session revoked');
            adminSubscriptionsRef.current.clear();
          }

          // Dispatch to admin subscribers
          if (adminSubscriptionsRef.current.size > 0) {
            adminSubscriptionsRef.current.forEach((cb) => {
              try {
                cb(data);
              } catch (cbErr) {
                console.error('[WebSocket] Admin callback error:', cbErr);
              }
            });
          }
        } catch (e) {
          console.error('[WebSocket] Failed to parse message', e);
        }
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        if (socketRef.current === ws) {
          socketRef.current = null;
        }
        // If the socket was closed due to admin session revocation (code 4001),
        // clear admin subscriptions to avoid unauthorized reconnect storm.
        if (event && event.code === 4001) {
          adminSubscriptionsRef.current.clear();
          // Only reconnect if customer is tracking orders
          if (orderSubscriptionsRef.current.size > 0) {
            scheduleReconnect(3000);
          }
          return;
        }
        scheduleReconnect(3000);
      };

      ws.onerror = () => {
        // Let onclose handle scheduling reconnect cleanly
        try {
          ws.close();
        } catch {
          // Socket already closed
        }
      };
    } catch (e) {
      console.error('[WebSocket] Connection initialization error:', e);
      scheduleReconnect(4000);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    connect();

    return () => {
      isMountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.onopen = null;
        socketRef.current.onmessage = null;
        socketRef.current.onclose = null;
        socketRef.current.onerror = null;
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, []);

  const subscribeOrder = useCallback((orderCode, phone, callback) => {
    let actualPhone = phone;
    let actualCallback = callback;
    if (typeof phone === 'function') {
      actualCallback = phone;
      actualPhone = '';
    }

    if (!orderCode || typeof actualCallback !== 'function') {
      return () => {};
    }

    const code = String(orderCode).trim().toUpperCase();
    const cleanPhone = actualPhone ? String(actualPhone).trim() : '';

    let entry = orderSubscriptionsRef.current.get(code);
    if (!entry) {
      entry = { phone: cleanPhone, callbacks: new Set() };
      orderSubscriptionsRef.current.set(code, entry);
    } else if (cleanPhone && !entry.phone) {
      entry.phone = cleanPhone;
    }

    entry.callbacks.add(actualCallback);

    // If socket is open, send subscription request immediately
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      try {
        socketRef.current.send(
          JSON.stringify({
            action: 'SUBSCRIBE_ORDER',
            orderCode: code,
            phone: entry.phone
          })
        );
      } catch (err) {
        console.error(`[WebSocket] Error sending SUBSCRIBE_ORDER for ${code}:`, err);
      }
    }

    return () => {
      const currentEntry = orderSubscriptionsRef.current.get(code);
      if (currentEntry) {
        currentEntry.callbacks.delete(actualCallback);
        if (currentEntry.callbacks.size === 0) {
          orderSubscriptionsRef.current.delete(code);
        }
      }
    };
  }, []);

  const subscribeAdmin = useCallback((callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    adminSubscriptionsRef.current.add(callback);

    // If socket is open, send subscription request immediately
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      try {
        socketRef.current.send(JSON.stringify({ action: 'SUBSCRIBE_ADMIN' }));
      } catch (err) {
        console.error('[WebSocket] Error sending SUBSCRIBE_ADMIN:', err);
      }
    }

    return () => {
      adminSubscriptionsRef.current.delete(callback);
    };
  }, []);

  return (
    <WebSocketContext.Provider value={{ isConnected, subscribeOrder, subscribeAdmin }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) throw new Error('useWebSocket must be used within WebSocketProvider');
  return context;
};
