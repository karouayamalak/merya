# MERYA DZ — Production Full-Stack Modest Fashion E-Commerce Platform

> **"Modest. Elegant. Timeless"**
>
> A commercial, production-ready full-stack e-commerce platform engineered specifically for **MERYA DZ**, an Algerian modest fashion brand catering to hijab-wearing women.

---

## 1. Visual Design & Brand Identity

The visual aesthetics strictly adhere to the official **MERYA DZ** brand identity and the design reference:
* **Brand Palette**: Warm champagne taupe (`#B89C82`), dark roasted espresso/mocha (`#2A241F`), soft warm ivory/sand (`#FAF8F5`, `#F2EFE9`), muted sage leaf (`#808B72`), and crisp white.
* **Typography**: Luxury editorial serifs (*Cormorant Garamond*) paired with high-legibility geometric sans-serif (*Plus Jakarta Sans*).
* **Reference Proportions**: Curved card silhouettes (`border-radius: 20px - 28px`), neutral contrast backdrops (`#F2EFE9`), interactive color swatches, and clean uppercase typographic hierarchy ("CREATE A MODEST VIBE", "NEW ARRIVALS", "EXPLORE CATEGORIES").
* **Algerian E-Commerce Context**:
  * Currency: **DZD** (Algerian Dinar, formatted cleanly e.g. `7,500 DZD`).
  * Full coverage for all **58 Wilayas of Algeria**.
  * Cash on Delivery (**Paiement à la livraison** / **الدفع عند الاستلام**).

---

## 2. Full-Stack Architecture

The system is strictly separated into independent frontend and backend services:

```
merya_dz/
├── backend/
│   ├── src/
│   │   ├── config/             # DB connection, environment variables, Algerian Wilayas, constants
│   │   ├── models/             # Mongoose schemas: Admin, Category, Product, Order, DeliverySetting
│   │   ├── middleware/         # Auth, RBAC, Rate-limiters, Validation, Upload, Error handler
│   │   ├── controllers/        # Auth, Category, Product, Order, Tracking, Delivery, Analytics, Upload
│   │   ├── routes/             # RESTful API endpoints (/api/v1/...)
│   │   ├── services/           # Atomic inventory service, Order state machine, WebSocket service
│   │   ├── utils/              # Order tracking code generator, structured logger
│   │   ├── seed/               # Database seeder (Admin account, delivery settings, catalog)
│   │   └── server.js           # Express + HTTP Server + WebSockets
│   ├── tests/                  # Automated integration & business logic unit tests
│   ├── uploads/                # WebP-optimized user uploads (Sharp processed)
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── public/                 # MERYA DZ official logo and assets
│   ├── src/
│   │   ├── components/         # Header, Footer, CategoryTile, ProductCard, CartDrawer
│   │   ├── pages/              # Home, Shop, ProductDetail, Checkout, OrderConfirmation, OrderTracking
│   │   ├── pages/admin/        # AdminLogin, AdminLayout, DashboardOverview, OrdersManager, ProductsManager, CategoriesManager, InventoryManager, DeliverySettingsManager
│   │   ├── context/            # CartContext, AdminAuthContext, WebSocketContext
│   │   ├── services/           # REST API client
│   │   ├── App.jsx             # Main router
│   │   ├── main.jsx            # Context Provider tree
│   │   └── index.css           # Design tokens, variables, and responsive typography
│   ├── vite.config.js          # Vite config with API & WebSocket reverse proxies
│   └── package.json
└── README.md
```

---

## 3. Database Schema & Integrity Guarantees

### Authoritative Database Models (MongoDB / Mongoose)
1. **Admin**: Secure credential store (`bcrypt` password hashing with salt factor 12), RBAC roles (`owner`, `admin`, `staff`).
2. **Category**: Name, slug (unique index), image, displayOrder, isActive, isArchived (soft-delete).
3. **Product**: Multi-variant matrix structured as `PRODUCT -> COLOR -> SIZE`:
   * Each color contains: `colorName`, `colorCode`, `images` (array of WebP URLs), `sizes` (array of `{ size, stock }`).
   * `costPrice`: Preserved strictly for backend profit calculations, never exposed to public storefront endpoints.
   * `sellingPrice`: Public price in DZD.
4. **Order**:
   * `orderCode`: Cryptographically unpredictable, secure 6-character uppercase code (e.g. `MD-8K3N9P`). Not enumerable.
   * `idempotencyKey`: Unique sparse index preventing double-orders on client/network retries.
   * `items`: Immutable snapshot of products, variants, selling prices, and cost prices at the time of purchase.
   * `status`: Controlled state machine (`Pending` → `Confirmed` → `On the way` → `At agency` → `Delivered` | `Cancelled`).
   * `stockRestored`: Atomic boolean safeguard preventing double-restoration of inventory on cancellations.
   * `auditHistory`: Chronological log recording action, timestamp, performedBy, and modifications.
5. **DeliverySetting**: Singleton document managing dynamic `agencyDeliveryFee`, `homeDeliveryFee`, and `freeDeliveryThreshold`.

---

## 4. Key Business Logic & Financial Integrity

### A. Atomic Inventory & Oversell Prevention
Stock is deducted atomically using MongoDB conditional array updates:
```javascript
Product.findOneAndUpdate(
  {
    _id: productId,
    isActive: true,
    colors: {
      $elemMatch: {
        colorName,
        sizes: { $elemMatch: { size, stock: { $gte: quantity } } }
      }
    }
  },
  { $inc: { "colors.$[c].sizes.$[s].stock": -quantity } },
  { arrayFilters: [{ "c.colorName": colorName }, { "s.size": size }] }
)
```
If two customers checkout the last item simultaneously, only one transaction consumes the stock; the other is rejected cleanly with an informative error.

### B. Order Cancellation & Stock Restoration
When an admin cancels an order:
* The system checks `order.stockRestored === false`.
* It increments variant stock back by `$inc: quantity`.
* Sets `order.stockRestored = true`.
* Cancelling an order twice or modifying a cancelled order cannot double-restore stock.

### C. Realized Profit Calculations
* **Rule**: Realized profit is recorded **ONLY** when an order reaches `Delivered`.
* Pending, confirmed, on-the-way, or cancelled orders **never** contribute to realized profit.
* Calculation: `Realized Profit = Σ (item.quantity * (item.unitPrice - item.unitCost))` across delivered orders.
* Historical snapshot prices are preserved: changing product prices today does not corrupt historical profit.

### D. Real-Time WebSockets
* Native `ws` WebSocket server mounted on the backend HTTP server.
* When an admin updates an order status, all clients viewing that specific order tracking page receive the update live without refreshing.
* When a customer places an order, the admin dashboard receives an instant live notification.

---

## 5. Security Measures

* **Authentication**: Admin credentials hashed with `bcryptjs`. JWT tokens stored in HttpOnly, SameSite cookies.
* **Authorization & RBAC**: Route middleware verifies admin active status and permissions.
* **Rate Limiting**:
  * Admin Login: Max 6 attempts / 15 min.
  * Order Tracking: Max 20 attempts / 10 min (mitigates tracking code enumeration).
  * Checkout: Max 15 attempts / 10 min.
  * General API: Max 500 requests / 15 min.
* **Input Validation**: Strict `Zod` schemas on all inputs.
* **Anti-Enumeration**: Tracking endpoint returns uniform 404 responses for mismatched phone/code pairs.
* **File Uploads**: `multer` memory storage + `sharp` image re-encoding to WebP; stripping EXIF metadata; blocking non-image uploads.
* **Security Headers**: `helmet` enabled with Cross-Origin Resource Policies configured.

---

## 6. Installation & Development Setup

### Prerequisites
* Node.js v18+
* MongoDB running locally or on MongoDB Atlas (default: `mongodb://127.0.0.1:27017/merya_dz`)

### 1. Backend Setup
```bash
cd backend
cp .env.example .env
npm install
npm run seed     # Seeds default admin, delivery fees, categories & products
npm test         # Runs automated business logic & integrity test suite
npm run dev      # Starts server on http://localhost:5000 with WebSockets on /ws
```

### 2. Frontend Setup
```bash
cd frontend
npm install
npm run dev      # Starts Vite dev server on http://localhost:5173
```

### 3. Default Admin Credentials
* **Email**: `admin@meryadz.com`
* **Password**: `MeryaAdmin2026!`
* Access via the **Owner Login** button in the footer or by navigating to the admin portal.

---

## 7. Testing & Verification

Run the test suite in `backend/`:
```bash
npm test
```
The automated test suite verifies:
1. **Overselling Prevention**: Rejection and rollback when stock is insufficient.
2. **Atomic Inventory Deduction & Delivery Fee Calculation**: Exact calculations for both Stopdesk/Agency and Home Delivery.
3. **Idempotency**: Duplicate submissions with the same idempotency key return the original order without deducting stock twice.
4. **Order Cancellation**: Inventory restored safely and only once.
5. **State Machine Transitions**: Disallows invalid jumps (e.g. Delivered -> Pending).
6. **Profit Calculation**: Proves realized profit only accumulates from Delivered orders.

---

## 8. Backup & Disaster Recovery Strategy

Because this application stores real financial, customer, and inventory data:
1. **Automated Database Dumps**:
   Run regular MongoDB dumps using cron or task scheduler:
   ```bash
   mongodump --uri="mongodb://127.0.0.1:27017/merya_dz" --out=/backups/$(date +%F_%T) --gzip
   ```
2. **Retention Policy**: Retain daily backups for 30 days, weekly backups for 12 months, and monthly financial snapshots indefinitely.
3. **Offsite Storage**: Push compressed backup archives to encrypted cloud storage (AWS S3 Glacier or Cloudflare R2).
4. **Database Restoration**:
   ```bash
   mongorestore --uri="mongodb://127.0.0.1:27017/merya_dz" --drop --gzip /backups/YYYY-MM-DD_HH-MM-SS/merya_dz
   ```
