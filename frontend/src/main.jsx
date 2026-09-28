import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { CartProvider } from './context/CartContext.jsx';
import { AdminAuthProvider } from './context/AdminAuthContext.jsx';
import { WebSocketProvider } from './context/WebSocketContext.jsx';
import { LanguageProvider } from './context/LanguageContext.jsx';
import { StoreSettingsProvider } from './context/StoreSettingsContext.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LanguageProvider>
      <WebSocketProvider>
        <AdminAuthProvider>
          <StoreSettingsProvider>
            <CartProvider>
              <App />
            </CartProvider>
          </StoreSettingsProvider>
        </AdminAuthProvider>
      </WebSocketProvider>
    </LanguageProvider>
  </React.StrictMode>
);

