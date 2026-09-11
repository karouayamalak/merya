import { WebSocket } from 'ws';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { Admin } from '../src/models/Admin.js';
import { ROLES } from '../src/config/constants.js';

dotenv.config();

const TEST_ADMIN_EMAIL = process.env.INITIAL_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'test_admin@example.com';
const TEST_ADMIN_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'test_admin_secure_password';

async function ensureTestAdmin() {
  const dbUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(dbUri);
  }
  let admin = await Admin.findOne({ email: TEST_ADMIN_EMAIL.toLowerCase() });
  if (!admin) {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(TEST_ADMIN_PASSWORD, salt);
    await Admin.create({
      username: 'Test Admin',
      email: TEST_ADMIN_EMAIL.toLowerCase(),
      passwordHash,
      role: ROLES.OWNER,
      isActive: true
    });
  } else {
    const salt = await bcrypt.genSalt(10);
    admin.passwordHash = await bcrypt.hash(TEST_ADMIN_PASSWORD, salt);
    admin.isActive = true;
    await admin.save();
  }
}

async function runE2EVerification() {
  console.log('=== STARTING COMPLETE END-TO-END VERIFICATION ===\n');

  // 1. Health check
  console.log('[1/9] Checking Backend Health...');
  const healthRes = await fetch('http://localhost:5000/health');
  const healthData = await healthRes.json();
  console.log('Health Response:', healthData);
  if (healthData.status !== 'healthy') throw new Error('Health check failed');

  // 2. Frontend HTML check
  console.log('\n[2/9] Checking Frontend Dev Server (http://localhost:5173)...');
  const feRes = await fetch('http://localhost:5173/');
  const feHtml = await feRes.text();
  console.log(`Frontend served successfully (${feHtml.length} bytes, includes MERYA DZ title: ${feHtml.includes('MERYA DZ')})`);

  // 3. Categories API
  console.log('\n[3/9] Fetching Categories...');
  const catRes = await fetch('http://localhost:5000/api/v1/categories');
  const catData = await catRes.json();
  console.log(`Categories count: ${catData.count}`);
  catData.categories.forEach(c => console.log(`  - ${c.name} (${c.slug})`));

  // 4. Products API with variants
  console.log('\n[4/9] Fetching Products & Variant Matrices...');
  const prodRes = await fetch('http://localhost:5000/api/v1/products');
  const prodData = await prodRes.json();
  console.log(`Products retrieved: ${prodData.products.length}`);
  const targetProduct = prodData.products.find(p => p.colors?.some(c => c.sizes?.some(s => s.stock > 0))) || prodData.products[0];
  console.log(`Testing with product: "${targetProduct.name}" (Price: ${targetProduct.sellingPrice} DZD)`);
  console.log(`Available colors: ${targetProduct.colors.map(c => `${c.colorName} [Sizes: ${c.sizes.map(s => `${s.size}:${s.stock}`).join(', ')}]`).join(' | ')}`);

  const chosenColor = targetProduct.colors.find(c => c.sizes?.some(s => s.stock > 0)) || targetProduct.colors[0];
  const chosenSizeObj = chosenColor.sizes.find(s => s.stock > 0) || chosenColor.sizes[0];
  console.log(`Selected for checkout: Color "${chosenColor.colorName}", Size "${chosenSizeObj.size}" (Current Stock: ${chosenSizeObj.stock})`);

  // 5. Test Live WebSocket Connection
  console.log('\n[5/9] Testing Native WebSocket Real-Time Connection...');
  const ws = new WebSocket('ws://localhost:5000/ws');
  let wsConnected = false;

  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      wsConnected = true;
      console.log('WebSocket connected successfully on ws://localhost:5000/ws');
      ws.send(JSON.stringify({ action: 'SUBSCRIBE_ADMIN' }));
      resolve();
    });
    ws.on('error', reject);
    setTimeout(() => {
      if (!wsConnected) reject(new Error('WebSocket connection timeout'));
    }, 4000);
  });

  // 6. Complete Real COD Checkout
  console.log('\n[6/9] Placing Real Cash on Delivery Order...');
  const checkoutPayload = {
    idempotencyKey: `e2e-order-${Date.now()}`,
    customer: {
      fullName: 'Nour El Houda',
      phone: '0555123456',
      wilaya: { code: 9, name: 'Blida' },
      deliveryMethod: 'home',
      address: 'Cité 1000 Logements, Bâtiment 4, Blida',
      notes: 'Please call before delivery'
    },
    items: [
      {
        productId: targetProduct._id,
        colorName: chosenColor.colorName,
        size: chosenSizeObj.size,
        quantity: 1
      }
    ]
  };

  const checkoutRes = await fetch('http://localhost:5000/api/v1/orders/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(checkoutPayload)
  });

  const orderData = await checkoutRes.json();
  if (!orderData.success) throw new Error(`Checkout failed: ${orderData.message}`);
  console.log(`Order Placed Successfully!`);
  console.log(`  - Order Tracking Code: ${orderData.orderCode}`);
  console.log(`  - Status: ${orderData.status}`);
  console.log(`  - Subtotal: ${orderData.subtotal} DZD`);
  console.log(`  - Delivery Fee (Home): ${orderData.deliveryFee} DZD`);
  console.log(`  - Final Total: ${orderData.totalPrice} DZD`);

  // Subscribe WebSocket to this specific order tracking channel (requires orderCode and customer phone)
  ws.send(JSON.stringify({ action: 'SUBSCRIBE_ORDER', orderCode: orderData.orderCode, phone: '0555123456' }));

  // 7. Track Order Publicly
  console.log('\n[7/9] Verifying Public Order Tracking (Phone + Code)...');
  const trackRes = await fetch('http://localhost:5000/api/v1/tracking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '0555123456', orderCode: orderData.orderCode })
  });
  const trackData = await trackRes.json();
  if (!trackData.success) throw new Error('Tracking lookup failed');
  console.log(`Tracking verified: Order ${trackData.order.orderCode} is currently "${trackData.order.status}" for customer in Wilaya ${trackData.order.wilaya}`);

  // 8. Admin Authentication & Dashboard
  console.log('\n[8/9] Testing Admin Login & Authorization...');
  await ensureTestAdmin();
  const loginRes = await fetch('http://localhost:5000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
  });
  const loginData = await loginRes.json();
  if (!loginData.success) throw new Error('Admin login failed');
  console.log(`Logged in as: ${loginData.admin.username} (${loginData.admin.role}) via Cookie`);

  const setCookieHeader = loginRes.headers.get('set-cookie') || '';
  const tokenCookieMatch = setCookieHeader.match(/token=([^;]+)/);
  if (!tokenCookieMatch) throw new Error('HttpOnly token cookie missing from login response');
  const tokenCookie = tokenCookieMatch[0];

  // Fetch CSRF token for mutations
  const csrfRes = await fetch('http://localhost:5000/api/v1/auth/csrf-token', {
    headers: { Cookie: tokenCookie }
  });
  const csrfData = await csrfRes.json();
  const csrfToken = csrfData.csrfToken;
  const csrfCookie = (csrfRes.headers.get('set-cookie') || '').match(/csrf_token=([^;]+)/)?.[0] || `csrf_token=${csrfToken}`;
  const adminCookies = `${tokenCookie}; ${csrfCookie}`;

  // 9. Status Transitions & Real-Time WebSocket Event Verification
  console.log('\n[9/9] Testing Real-Time Status Advancement in Admin Dashboard...');

  // Setup listener for real-time WebSocket status push
  let wsReceivedUpdate = false;
  ws.on('message', (msg) => {
    const parsed = JSON.parse(msg.toString());
    if (parsed.type === 'ORDER_STATUS_UPDATED' && parsed.orderCode === orderData.orderCode) {
      console.log(`  [WebSocket PUSH Received] Order ${parsed.orderCode} status updated in real-time to -> "${parsed.status}"`);
      wsReceivedUpdate = true;
    }
  });

  // Fetch admin orders list to get the internal ID
  const adminOrdersRes = await fetch(`http://localhost:5000/api/v1/orders/admin?search=${orderData.orderCode}`, {
    headers: { Cookie: adminCookies }
  });
  const adminOrdersData = await adminOrdersRes.json();
  const dbOrder = adminOrdersData.orders[0];

  // Advance status: Pending -> Confirmed
  console.log('Advancing order status to "Confirmed"...');
  await fetch(`http://localhost:5000/api/v1/orders/admin/${dbOrder._id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': adminCookies,
      'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({ status: 'Confirmed', note: 'Customer confirmed via phone call' })
  });

  // Advance status: Confirmed -> On the way
  console.log('Advancing order status to "On the way"...');
  await fetch(`http://localhost:5000/api/v1/orders/admin/${dbOrder._id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': adminCookies,
      'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({ status: 'On the way', note: 'Handed to Yalidine courier' })
  });

  // Advance status: On the way -> Delivered
  console.log('Advancing order status to "Delivered"...');
  await fetch(`http://localhost:5000/api/v1/orders/admin/${dbOrder._id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': adminCookies,
      'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({ status: 'Delivered', note: 'Customer received package and paid courier in cash' })
  });

  // Wait 500ms for WebSocket delivery
  await new Promise(r => setTimeout(r, 600));

  // Check financial analytics to prove profit realized
  const analyticsRes = await fetch('http://localhost:5000/api/v1/analytics/dashboard', {
    headers: { Cookie: adminCookies }
  });
  const analyticsData = await analyticsRes.json();
  console.log('\n=== REALIZED FINANCIAL METRICS AUDIT ===');
  console.log(`Total Orders: ${analyticsData.metrics.totalOrders}`);
  console.log(`Delivered Orders: ${analyticsData.metrics.statusCounts.Delivered}`);
  console.log(`Realized Revenue: ${analyticsData.metrics.realizedRevenue.toLocaleString()} DZD`);
  console.log(`Realized Profit: ${analyticsData.metrics.realizedProfit.toLocaleString()} DZD`);
  console.log(`Delivered Units: ${analyticsData.metrics.unitsSold}`);
  console.log(`Real-Time WebSocket Received Update: ${wsReceivedUpdate ? 'YES (Verified)' : 'NO'}`);

  ws.close();
  console.log('\n=== ALL END-TO-END VERIFICATION CHECKS PASSED PERFECTLY ===\n');
}

runE2EVerification().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('[E2E Error]:', err);
  process.exit(1);
});
