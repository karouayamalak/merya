<div align="center">

<img src="frontend/public/logo.png" alt="MERYA DZ Logo" width="180" />

# MERYA DZ — Modest Fashion E-Commerce Platform

**Modest. Elegant. Timeless.**

A production-grade, full-stack e-commerce platform engineered for the Algerian modest fashion market, targeting hijab-wearing women across all 58 wilayas.

[![Node.js](https://img.shields.io/badge/Node.js-22.x-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![MongoDB](https://img.shields.io/badge/MongoDB-8.x-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://mongodb.com)
[![Express](https://img.shields.io/badge/Express-4.x-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com)
[![Vite](https://img.shields.io/badge/Vite-8.x-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)
[![License](https://img.shields.io/badge/License-Private-red?style=flat-square)](LICENSE)

</div>

---

## Table of Contents

- [Overview](#overview)
- [Live Architecture](#live-architecture)
- [Feature Set](#feature-set)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Business Logic](#business-logic)
- [Security Model](#security-model)
- [Admin Dashboard](#admin-dashboard)
- [Algerian Market Specifics](#algerian-market-specifics)
- [Test Suite](#test-suite)
- [Deployment](#deployment)
- [Contributing](#contributing)

---

## Overview

MERYA DZ is a **commercial-grade** full-stack e-commerce application — not a prototype. It is designed to handle real customers, real inventory, real orders, and real financial data for a modest fashion boutique operating within Algeria.

The platform is built around these core principles:

- **Backend is the source of truth** — all business logic, inventory management, and financial calculations live server-side
- **Security-first** — JWT HttpOnly cookies, RBAC, rate limiting, Helmet CSP headers, Zod input validation
- **Real-time** — WebSocket push notifications keep customers informed of order status changes the instant the admin updates them
- **Atomic operations** — inventory deductions and stock restorations use MongoDB conditional updates to prevent overselling, even under concurrent load
- **Algerian-native** — built for DZD currency, Cash on Delivery (COD/Paiement à la livraison), and all 58 wilayas with dynamically configured delivery fees

---

## Live Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENT (Browser)                        │
│                                                             │
│   React 19 + Vite 8                                         │
│   ├── Storefront (Public)                                   │
│   │   ├── Hero / Category Discovery / Product Grid         │
│   │   ├── Product Detail (color/size variant matrix)       │
│   │   ├── Cart Drawer (persistent, context-based)          │
│   │   ├── Checkout (COD, 58 Wilayas, Agency/Home)          │
│   │   ├── Order Confirmation (confetti + order code)       │
│   │   └── Order Tracking (real-time WebSocket feed)        │
│   └── Admin Panel (Protected /admin route)                  │
│       ├── Dashboard Overview (live revenue analytics)       │
│       ├── Orders Manager (status state machine)             │
│       ├── Products Manager (multi-color/size/image upload)  │
│       ├── Categories Manager (drag-reorder, image upload)   │
│       ├── Inventory Manager (quick stock adjust)            │
│       └── Delivery Settings (per-wilaya rate config)        │
└────────────────────┬───────────────────────┬────────────────┘
                     │ HTTP REST              │ WebSocket
                     ▼                        ▼
┌─────────────────────────────────────────────────────────────┐
│                   BACKEND (Node.js + Express)                │
│                                                             │
│   API Routes: /api/v1/*                                     │
│   ├── /auth          → Login, logout, session verify        │
│   ├── /categories    → CRUD + display order management      │
│   ├── /products      → CRUD + variant matrix management     │
│   ├── /orders        → Place COD, status state machine      │
│   ├── /tracking      → Public order lookup (no auth)        │
│   ├── /settings      → Delivery fee config per wilaya       │
│   ├── /analytics     → Revenue, profit, KPI aggregations    │
│   └── /upload        → Multipart → Sharp → WebP pipeline    │
│                                                             │
│   WebSocket (/ws)                                           │
│   └── Pub/Sub channels: order:<orderCode>                   │
│                                                             │
│   Middleware Stack                                          │
│   ├── Helmet (CSP, HSTS, XSS protection)                   │
│   ├── CORS (strict allowlist)                               │
│   ├── express-rate-limit (100 req/15min per IP)             │
│   ├── JWT verify (HttpOnly signed cookies)                  │
│   ├── RBAC (owner / manager roles)                          │
│   ├── Zod schema validation                                 │
│   └── Centralized error handler                             │
└────────────────────────────────┬───────────────────────────┘
                                 │ Mongoose ODM
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│                        MongoDB                               │
│                                                             │
│   Collections                                               │
│   ├── admins           (bcrypt-hashed passwords, RBAC)      │
│   ├── categories       (slug, displayOrder, image)          │
│   ├── products         (colors[] → sizes[] → stock)         │
│   ├── orders           (COD, idempotency, state machine)    │
│   └── deliverysettings (singleton, 58 wilaya rate map)      │
└─────────────────────────────────────────────────────────────┘
```

---

## Feature Set

### Storefront

| Feature | Details |
|---------|---------|
| **Hero Campaign** | Full-bleed editorial image with centered logo and CTA |
| **Category Discovery** | Dynamic grid loaded from DB, admin-managed images |
| **Product Grid** | Filter by category, best-sellers, new arrivals |
| **Variant Matrix** | Color swatches → size grid → real-time stock indicators |
| **Cart Drawer** | Slide-in drawer, quantity control, persists across navigation |
| **COD Checkout** | 58-wilaya selector, Agency Pickup / Home Delivery toggle |
| **Order Confirmation** | Confetti animation, cryptographic order code display |
| **Live Order Tracking** | WebSocket-powered timeline — updates without page refresh |

### Admin Dashboard

| Module | Capabilities |
|--------|-------------|
| **Analytics** | Realized revenue (delivered only), profit margin, order KPIs |
| **Orders** | Full table, per-order status advancement, customer editor |
| **Products** | Create/edit/delete, multi-color + multi-size, image bulk upload |
| **Categories** | Create/edit/delete/reorder, image upload, active toggle |
| **Inventory** | Per-variant quick stock adjustment table |
| **Delivery Settings** | Global fees + per-wilaya overrides for all 58 wilayas |

---

## Tech Stack

### Backend
| Package | Version | Purpose |
|---------|---------|---------|
| `express` | 4.x | HTTP server and REST API framework |
| `mongoose` | 8.x | MongoDB ODM with schema validation |
| `jsonwebtoken` | 9.x | Stateless JWT auth (HttpOnly cookies) |
| `bcryptjs` | 2.x | Password hashing (12 salt rounds) |
| `ws` | 8.x | Native WebSocket server for real-time push |
| `sharp` | 0.33.x | Server-side image processing and WebP conversion |
| `multer` | 1.4.x | Multipart file upload handling |
| `zod` | 3.x | Runtime request body schema validation |
| `helmet` | 7.x | Security headers (CSP, HSTS, XSS, etc.) |
| `express-rate-limit` | 7.x | IP-based rate limiting (100 req/15 min) |
| `cors` | 2.x | Strict origin allowlist CORS |
| `cookie-parser` | 1.x | Signed cookie parsing |
| `morgan` | 1.x | HTTP request logger |

### Frontend
| Package | Version | Purpose |
|---------|---------|---------|
| `react` | 19.x | UI component framework |
| `vite` | 8.x | Build tool and dev server |
| `lucide-react` | 1.43.x | Icon library |
| `canvas-confetti` | 1.9.x | Order confirmation celebration effect |

### Design System
- **Typography**: Cormorant Garamond (editorial serif) + Plus Jakarta Sans (modern sans) — via Google Fonts
- **Palette**: Warm champagne taupe `#B89C82`, deep espresso `#2A241F`, soft sand `#FAF8F5`
- **CSS**: Pure vanilla CSS with custom properties (no Tailwind, no CSS-in-JS)

---

## Project Structure

```
merya_dz/
│
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── constants.js          # ROLES enum, ALGERIA_WILAYAS (all 58)
│   │   │   └── db.js                 # Mongoose connection with retry logic
│   │   │
│   │   ├── models/
│   │   │   ├── Admin.js              # Admin user schema (bcrypt, RBAC)
│   │   │   ├── Category.js           # Category with slug + displayOrder
│   │   │   ├── Product.js            # Nested colors[] → sizes[] → stock
│   │   │   ├── Order.js              # COD order with idempotency key
│   │   │   └── DeliverySetting.js    # Singleton with 58-wilaya rate map
│   │   │
│   │   ├── controllers/
│   │   │   ├── authController.js     # Login, logout, session verify
│   │   │   ├── categoryController.js # CRUD + reorder
│   │   │   ├── productController.js  # CRUD + variant management
│   │   │   ├── orderController.js    # Place order, state machine
│   │   │   ├── trackingController.js # Public order lookup
│   │   │   ├── deliverySettingController.js
│   │   │   ├── analyticsController.js
│   │   │   └── uploadController.js   # Sharp WebP pipeline
│   │   │
│   │   ├── middleware/
│   │   │   ├── auth.js               # JWT verify + RBAC guard
│   │   │   ├── rateLimiter.js        # express-rate-limit config
│   │   │   ├── upload.js             # Multer + file type validation
│   │   │   ├── validation.js         # Zod schema validators
│   │   │   └── errorHandler.js       # Centralized error response
│   │   │
│   │   ├── routes/
│   │   │   ├── authRoutes.js
│   │   │   ├── categoryRoutes.js
│   │   │   ├── productRoutes.js
│   │   │   ├── orderRoutes.js
│   │   │   ├── trackingRoutes.js
│   │   │   ├── settingRoutes.js
│   │   │   ├── analyticsRoutes.js
│   │   │   └── uploadRoutes.js
│   │   │
│   │   ├── services/
│   │   │   ├── inventoryService.js   # Atomic MongoDB stock operations
│   │   │   ├── orderService.js       # Order state machine transitions
│   │   │   └── websocketService.js   # WS pub/sub channel manager
│   │   │
│   │   ├── utils/
│   │   │   ├── orderCode.js          # Crypto-random MD-XXXXXX generator
│   │   │   └── process_logo.js       # Logo processing utility
│   │   │
│   │   ├── seed/
│   │   │   └── seed.js               # DB seeder (admin, categories, products, delivery)
│   │   │
│   │   └── server.js                 # Entry — Express + HTTP + WebSocket bootstrap
│   │
│   ├── tests/
│   │   ├── businessLogic.test.js     # Unit tests (Node built-in test runner)
│   │   └── e2eVerification.js        # Full E2E integration verifier
│   │
│   ├── uploads/                      # Runtime image storage (gitignored)
│   │   └── .gitkeep
│   │
│   ├── .env.example                  # Environment variable template
│   └── package.json
│
├── frontend/
│   ├── public/
│   │   ├── logo.png                  # MERYA DZ brand logo (dark espresso)
│   │   ├── logo_white.png            # White variant for dark backgrounds
│   │   ├── favicon.svg
│   │   └── uploads/                  # Dev-mode mirrored uploads (gitignored)
│   │
│   ├── src/
│   │   ├── components/
│   │   │   ├── Header.jsx            # Sticky nav with cart badge
│   │   │   ├── Footer.jsx            # Brand footer with links
│   │   │   ├── CategoryTile.jsx      # Hover-zoom category cards
│   │   │   ├── ProductCard.jsx       # Color swatch interactive card
│   │   │   └── CartDrawer.jsx        # Slide-in cart with quantity control
│   │   │
│   │   ├── pages/
│   │   │   ├── Home.jsx              # Hero + Categories + Best Sellers + Editorial
│   │   │   ├── Shop.jsx              # Filterable product grid
│   │   │   ├── ProductDetail.jsx     # Variant selector + add to cart
│   │   │   ├── Checkout.jsx          # COD form, wilaya selector, delivery toggle
│   │   │   ├── OrderConfirmation.jsx # Confetti + order code display
│   │   │   ├── OrderTracking.jsx     # Live WebSocket tracking timeline
│   │   │   └── admin/
│   │   │       ├── AdminLogin.jsx
│   │   │       ├── AdminLayout.jsx
│   │   │       ├── DashboardOverview.jsx
│   │   │       ├── OrdersManager.jsx
│   │   │       ├── ProductsManager.jsx
│   │   │       ├── CategoriesManager.jsx
│   │   │       ├── InventoryManager.jsx
│   │   │       └── DeliverySettingsManager.jsx
│   │   │
│   │   ├── context/
│   │   │   ├── CartContext.jsx       # Global cart state (quantity, items, drawer)
│   │   │   ├── AdminAuthContext.jsx  # Admin session state
│   │   │   └── WebSocketContext.jsx  # WS connection lifecycle
│   │   │
│   │   ├── services/
│   │   │   └── api.js                # Typed REST client (fetch + credentials)
│   │   │
│   │   ├── App.jsx                   # View router (SPA, no React Router)
│   │   ├── main.jsx                  # Context provider tree
│   │   └── index.css                 # Design tokens, typography, utility classes
│   │
│   ├── vite.config.js                # Proxy: /api → :5000, /ws → ws://localhost:5000
│   └── package.json
│
├── .gitignore
└── README.md
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) v20+
- [MongoDB](https://mongodb.com/try/download/community) v7+ running locally
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/karouayamalak/merya.git
cd merya
```

### 2. Configure the Backend

```bash
cd backend
cp .env.example .env
```

Edit `.env` with your values (see [Environment Variables](#environment-variables)).

### 3. Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 4. Seed the Database

This creates the admin account, default categories, sample products, and all 58 wilaya delivery settings:

```bash
cd backend
npm run seed
```

> **Default admin credentials created by the seeder:**
> - Email: `admin@meryadz.com`
> - Password: `MeryaAdmin2026!`
> 
> ⚠️ **Change these immediately** after first login in a production environment.

### 5. Start Development Servers

Open two terminal windows:

```bash
# Terminal 1 — Backend (port 5000)
cd backend
npm run dev

# Terminal 2 — Frontend (port 5173)
cd frontend
npm run dev
```

### 6. Open in Browser

| URL | Description |
|-----|-------------|
| `http://localhost:5173` | Customer storefront |
| `http://localhost:5173/admin` | Admin dashboard (login required) |
| `http://localhost:5000/health` | Backend health check |

---

## Environment Variables

All environment variables live in `backend/.env`. Copy `backend/.env.example` as a starting point.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `5000` | Backend HTTP server port |
| `NODE_ENV` | No | `development` | `development` / `production` / `test` |
| `MONGODB_URI` | **Yes** | — | MongoDB connection string |
| `JWT_SECRET` | **Yes** | — | Secret for signing JWT tokens (min 32 chars) |
| `JWT_EXPIRES_IN` | No | `7d` | JWT token expiry duration |
| `COOKIE_SECRET` | **Yes** | — | Secret for signing HttpOnly cookies |
| `CLIENT_ORIGIN` | **Yes** | — | Frontend URL for CORS allowlist (e.g. `https://meryadz.com`) |
| `UPLOAD_DIR` | No | `uploads` | Directory for user-uploaded images (relative to backend/) |

> ⚠️ **Never commit `.env` to source control.** It is listed in `.gitignore`.

---

## API Reference

All endpoints are prefixed with `/api/v1`. 🔒 = requires admin JWT cookie.

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/auth/login` | Public | Admin login, sets HttpOnly JWT cookie |
| `POST` | `/auth/logout` | 🔒 | Clears session cookie |
| `GET` | `/auth/me` | 🔒 | Returns current admin session |

### Categories
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/categories` | Public | List all active categories (sorted by displayOrder) |
| `POST` | `/categories` | 🔒 | Create category |
| `PUT` | `/categories/:id` | 🔒 | Update category |
| `DELETE` | `/categories/:id` | 🔒 | Delete category |
| `PATCH` | `/categories/reorder` | 🔒 | Update displayOrder of multiple categories |

### Products
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/products` | Public | List products (filter: `category`, `isBestSeller`, `limit`) |
| `GET` | `/products/:slug` | Public | Single product with full variant matrix |
| `POST` | `/products` | 🔒 | Create product with variants |
| `PUT` | `/products/:id` | 🔒 | Update product |
| `DELETE` | `/products/:id` | 🔒 | Soft delete (sets `isActive: false`) |

### Orders
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/orders` | Public | Place a COD order (idempotent) |
| `GET` | `/orders` | 🔒 | List all orders (paginated, filterable by status) |
| `GET` | `/orders/:id` | 🔒 | Single order detail |
| `PATCH` | `/orders/:id/status` | 🔒 | Advance order status (state machine enforced) |
| `PATCH` | `/orders/:id/customer` | 🔒 | Edit customer details |

### Tracking
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/tracking/:orderCode` | Public | Look up order status by code + phone |

### Settings
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/settings/delivery` | Public | Get delivery fees and wilaya rate map |
| `PUT` | `/settings/delivery` | 🔒 | Update global and per-wilaya delivery fees |

### Analytics
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/analytics/overview` | 🔒 | Revenue, profit, order counts by status |

### Upload
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/upload/image` | 🔒 | Upload image → Sharp WebP conversion → returns URL |

### WebSocket

Connect to `ws://localhost:5000/ws` and subscribe to an order channel:

```js
const ws = new WebSocket('ws://localhost:5000/ws');

ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'subscribe', channel: 'order:MD-5YNYMS' }));
};

ws.onmessage = ({ data }) => {
  const { type, status } = JSON.parse(data);
  if (type === 'ORDER_STATUS_UPDATE') {
    console.log('New status:', status); // e.g. "On the way"
  }
};
```

---

## Business Logic

### 1. Atomic Inventory & Overselling Prevention

Stock deduction on checkout uses a **conditional MongoDB atomic update**:

```js
// inventoryService.js — simplified
await Product.updateOne(
  {
    _id: productId,
    'colors.colorName': colorName,
    'colors.sizes': {
      $elemMatch: { size, stock: { $gte: requestedQty } }
    }
  },
  { $inc: { 'colors.$[c].sizes.$[s].stock': -requestedQty } },
  { arrayFilters: [{ 'c.colorName': colorName }, { 's.size': size }] }
);
```

If stock is insufficient at the moment of the DB write, the update matches 0 documents and the order is rejected — even under high concurrency.

### 2. Order State Machine

Orders follow a strict one-way state machine. Invalid transitions (e.g. jumping from `Pending` to `Delivered`) are rejected server-side.

```
Pending → Confirmed → On the way → At agency → Delivered
                                              ↘ Cancelled (from any state except Delivered)
```

### 3. Idempotency

Each checkout request includes a client-generated `idempotencyKey`. If the same key is submitted twice (e.g. double-click or network retry), the server returns the **original order** without creating a duplicate or deducting stock again.

### 4. Realized Profit Calculation

Profit is only recognized on **Delivered** orders — never on pending, confirmed, or cancelled orders:

```js
// analyticsController.js
const delivered = await Order.find({ status: 'Delivered' });
const profit = delivered.reduce((sum, order) =>
  sum + order.items.reduce((s, item) =>
    s + item.quantity * (item.unitPrice - item.unitCost), 0
  ), 0
);
```

### 5. Cryptographic Order Codes

Order codes are generated using Node.js `crypto.randomBytes` — not sequential IDs — preventing order enumeration:

```js
// utils/orderCode.js
import { randomBytes } from 'crypto';
export const generateOrderCode = () =>
  'MD-' + randomBytes(3).toString('hex').toUpperCase().slice(0, 6);
// Output example: MD-5YNYMS
```

### 6. Stock Restoration on Cancellation

When an admin cancels an order, stock is restored atomically. A boolean flag `order.stockRestored` prevents any double-restoration (e.g., from duplicate API calls):

```js
if (!order.stockRestored) {
  await restoreStock(order.items);
  order.stockRestored = true;
  await order.save();
}
```

---

## Security Model

| Layer | Mechanism |
|-------|-----------|
| **Authentication** | Cookie-only: JWT stored strictly in `HttpOnly; Secure; SameSite` cookies. Bearer header fallback and localStorage storage are completely removed. JSON login responses never contain the JWT. |
| **CSRF Protection** | Double-submit signed cookie pattern (`X-CSRF-Token` header + `csrf_token` cookie). HMAC-SHA256 signed with 1-hour expiry, verified using constant-time comparison (`crypto.timingSafeEqual`). Required on all admin mutations (POST/PUT/PATCH/DELETE). Public checkout/tracking bypass intentionally. |
| **WebSocket Security** | Strict `Origin` header validation enforced in production (close code `1008` on untrusted origin). Admin clients authenticated via upgrade cookie — no plaintext JWT in WS messages. |
| **Database Transactions** | MongoDB multi-document transactions mandatory in production for checkout, cancellations, returns, reactivations, and inventory adjustments. Fails closed (`503 TRANSACTION_UNAVAILABLE`) if replica set transactions are absent. |
| **Authorization** | RBAC middleware: `owner` vs `admin` roles with per-route guards. |
| **Password Storage** | `bcryptjs` with 12 salt rounds. |
| **Input Validation** | All request bodies validated against Zod schemas before reaching controllers; strict integer stock validation on both frontend and backend. |
| **Rate Limiting** | `express-rate-limit` — separate limiters for API endpoints (100 req/15min) and auth login (5 req/15min). |
| **Security Headers** | `helmet` sets CSP, HSTS, X-Frame-Options, X-Content-Type-Options, and more. |
| **CORS** | Strict allowlist — restricted to `CLIENT_ORIGIN` in production with credentials support. |
| **File Uploads** | Multer validates MIME type + enforces 10 MB limit; Sharp re-encodes to WebP stripping EXIF metadata. |
| **Admin Route** | `/admin` — no link from the public storefront; accessible only by direct URL. |

---

## Admin Dashboard

Access at **`/admin`** — direct URL only, no public link.

### Default Credentials (from seeder)

```
Email:    admin@meryadz.com
Password: MeryaAdmin2026!
```

> ⚠️ Change the password immediately after first deployment using the admin profile settings.

### Dashboard Modules

#### 📊 Overview
- Total orders by status (Pending, Confirmed, On the way, At agency, Delivered, Cancelled)
- Realized revenue in DZD (Delivered orders only)
- Realized profit in DZD (revenue minus cost price per item)

#### 📦 Orders Manager
- Full paginated order table with customer details, wilaya, delivery method
- One-click status advancement following the state machine
- Customer information editor (name, phone, address correction)

#### 👗 Products Manager
- Create/edit products with full multi-color + multi-size variant matrices
- Upload multiple images per color variant (processed to WebP via Sharp)
- Best-seller and active/inactive toggles

#### 🗂️ Categories Manager
- Drag-free display order management
- Image upload per category
- Active/inactive toggle

#### 📋 Inventory Manager
- Flat table view of every product → color → size → stock
- Inline quick-adjust input for rapid stock corrections

#### 🚚 Delivery Settings Manager
- Configure global agency and home delivery base fees
- Override fees per wilaya (all 58 wilaya individually configurable)
- Toggle wilaya availability

---

## Algerian Market Specifics

### Currency
All prices are in **DZD (Algerian Dinar)**, displayed as `7,500 DZD`.

### Payment
**Cash on Delivery (COD) only** — the standard payment method for Algerian e-commerce. No online payment gateway.

### 58 Wilayas
The platform ships to all 58 Algerian wilayas. Each wilaya has:
- Arabic and French name
- Configurable home delivery fee
- Configurable agency (stopdesk) pickup fee
- Availability toggle (disable delivery to a wilaya)

Default fee zones seeded at setup:

| Zone | Wilayas | Home Delivery | Agency Pickup |
|------|---------|---------------|---------------|
| Alger | W16 | 500 DZD | 350 DZD |
| Near | W9, W35, W42 | 600 DZD | 400 DZD |
| Mid | W31, W25, W19... | 750 DZD | 450 DZD |
| Far | W3, W4, W7... | 850 DZD | 500 DZD |
| Remote | W8, W30, W32... | 1,000 DZD | 700 DZD |
| Extreme South | Remaining | 1,400 DZD | 900 DZD |

### Delivery Methods
- **Agency Pickup (Stopdesk)** — Customer collects from a Yalidine/Zex hub. Admin enters agency name.
- **Home Delivery (À Domicile)** — Delivered to customer's door. Customer enters full street address.

---

## Test Suite

### Unit Tests — Business Logic

Uses Node.js built-in `node:test` runner (no Jest required):

```bash
cd backend
npm test
```

**Test coverage:**

```
▶ MERYA DZ Core Business Logic & Inventory Integrity
  ✔ 1. Overselling Prevention: Rejects checkout when requested qty exceeds stock
  ✔ 2. Atomic Inventory Deduction & Fee Calculation on valid checkout
  ✔ 3. Idempotency: Duplicate submission returns original order, no double-deduction
  ✔ 4. Order Cancellation restores stock atomically and only once
  ✔ 5. State Machine Validation: Disallows invalid status transitions
  ✔ 6. Profit Calculation: ONLY Delivered orders contribute to realized profit
✔ MERYA DZ Core Business Logic & Inventory Integrity (481ms)
```

### End-to-End Verification

```bash
cd backend
node tests/e2eVerification.js
```

Runs a full verification pipeline against the live servers:
1. Backend health check
2. Frontend HTTP check
3. Category and product API checks
4. Native WebSocket connection
5. Full COD order placement (real DB write)
6. Public tracking lookup
7. Admin login and authorization
8. Real-time status advancement with WebSocket push confirmation
9. Financial metrics audit

---

## Deployment

### Prerequisites
- VPS or cloud instance with Node.js 20+
- MongoDB Atlas cluster (or self-hosted MongoDB)
- A domain name with HTTPS (SSL certificate via Let's Encrypt or Cloudflare)

### Backend

```bash
# Install production dependencies
cd backend
npm install --omit=dev

# Set all environment variables in .env
# Ensure NODE_ENV=production

# Start with a process manager (recommended: PM2)
npm install -g pm2
pm2 start src/server.js --name merya-backend
pm2 save
pm2 startup
```

### Frontend

```bash
cd frontend
npm run build
# Deploy the generated /dist folder to your static hosting or CDN
# (Vercel, Netlify, Nginx, etc.)
```

### Nginx Reverse Proxy (example)

```nginx
server {
    listen 443 ssl;
    server_name meryadz.com;

    # Serve frontend static files
    root /var/www/merya/frontend/dist;
    index index.html;
    try_files $uri $uri/ /index.html;

    # Proxy API requests to backend
    location /api/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Proxy WebSocket connections
    location /ws {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Serve uploaded images
    location /uploads/ {
        alias /var/www/merya/backend/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### Important Production Checklist

- [ ] Change `admin@meryadz.com` password after first login
- [ ] Set strong random `JWT_SECRET` (min 64 chars)
- [ ] Set strong random `COOKIE_SECRET`
- [ ] Set `NODE_ENV=production`
- [ ] Point `CLIENT_ORIGIN` to your real domain
- [ ] Enable HTTPS — JWT cookies require `Secure` flag in production
- [ ] Set up MongoDB Atlas backups
- [ ] Configure PM2 to auto-restart on crash
- [ ] Set up log rotation

---

## Contributing

This is a private commercial project. Contributions are not open to the public.

For internal bug fixes or feature additions:

1. Create a feature branch: `git checkout -b feat/your-feature`
2. Make your changes and run tests: `npm test`
3. Commit with conventional commits: `git commit -m "feat: add X"`
4. Push and open a pull request

---

<div align="center">

**MERYA DZ** — Built with care for modest fashion in Algeria 🇩🇿

*Modest. Elegant. Timeless.*

</div>
