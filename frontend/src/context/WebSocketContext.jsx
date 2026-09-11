import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

const WebSocketContext = createContext();

export function WebSocketProvider({ children }) {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef(null);
  const listenersRef = useRef(new Map()); // channel -> Set<callback>

  const connect = () => {
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

    try {
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        console.log('[WebSocket Client] Connected to', wsUrl);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const { type, orderCode } = data;

          // Dispatch to matching listeners
          if (type === 'ORDER_STATUS_UPDATED' && orderCode) {
            const callbacks = listenersRef.current.get(`order:${orderCode}`);
            if (callbacks) {
              callbacks.forEach((cb) => cb(data));
            }
          }

          // Dispatch to admin listeners
          const adminCallbacks = listenersRef.current.get('admin');
          if (adminCallbacks) {
            adminCallbacks.forEach((cb) => cb(data));
          }
        } catch (e) {
          console.error('[WebSocket] Failed to parse message', e);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Reconnect after 3s delay
        setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch (e) {
      console.error('[WebSocket] Connection error:', e);
      setTimeout(connect, 4000);
    }
  };

  useEffect(() => {
    connect();
    return () => {
      if (socketRef.current) socketRef.current.close();
    };
  }, []);

  const subscribeOrder = (orderCode, callback) => {
    const code = orderCode.trim().toUpperCase();
    const channel = `order:${code}`;

    if (!listenersRef.current.has(channel)) {
      listenersRef.current.set(channel, new Set());
    }
    listenersRef.current.get(channel).add(callback);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          action: 'SUBSCRIBE_ORDER',
          orderCode: code
        })
      );
    }

    return () => {
      const set = listenersRef.current.get(channel);
      if (set) {
        set.delete(callback);
        if (set.size === 0) listenersRef.current.delete(channel);
      }
    };
  };

  const subscribeAdmin = (callback) => {
    const channel = 'admin';
    if (!listenersRef.current.has(channel)) {
      listenersRef.current.set(channel, new Set());
    }
    listenersRef.current.get(channel).add(callback);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ action: 'SUBSCRIBE_ADMIN' }));
    }

    return () => {
      const set = listenersRef.current.get(channel);
      if (set) {
        set.delete(callback);
        if (set.size === 0) listenersRef.current.delete(channel);
      }
    };
  };

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
