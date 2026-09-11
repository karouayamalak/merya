import assert from 'node:assert';
import dotenv from 'dotenv';
import { WebSocket } from 'ws';

dotenv.config();

const API_BASE = 'http://localhost:5000/api/v1';

async function runCompleteSmokeTest() {
  console.log('================================================================');
  console.log('  MERYA DZ — FULL END-TO-END PRE-LAUNCH SMOKE & LIFECYCLE TEST  ');
  console.log('================================================================\n');

  // -------------------------------------------------------------
  // PHASE 1: CUSTOMER STOREFRONT & REAL ORDER PLACEMENT
  // -------------------------------------------------------------
  console.log('--- [PHASE 1: CUSTOMER STOREFRONT & ORDER PLACEMENT] ---');
  
  // 1. Fetch Categories
  console.log('Step 1.1: Loading Storefront Categories...');
  const catRes = await fetch(`${API_BASE}/categories`);
  const catData = await catRes.json();
  assert(catData.success && catData.categories.length > 0, 'Categories failed to load');
  console.log(`  ✓ Loaded ${catData.categories.length} categories.`);

  // 2. Fetch Products
  console.log('Step 1.2: Loading Storefront Products...');
  const prodRes = await fetch(`${API_BASE}/products`);
  const prodData = await prodRes.json();
  assert(prodData.success && prodData.products.length > 0, 'Products failed to load');
  
  // Find an in-stock product and variant
  const inStockProduct = prodData.products.find(p => 
    p.colors.some(c => c.sizes.some(s => s.stock >= 3))
  );
  assert(inStockProduct, 'No suitable product with at least 3 units of stock found');
  
  const chosenColor = inStockProduct.colors.find(c => c.sizes.some(s => s.stock >= 3));
  const chosenSize = chosenColor.sizes.find(s => s.stock >= 3);
  const initialStock = chosenSize.stock;
  
  console.log(`  ✓ Selected Product: "${inStockProduct.name}" (${inStockProduct._id})`);
  console.log(`    Variant: Color="${chosenColor.colorName}", Size="${chosenSize.size}"`);
  console.log(`    Initial Stock: ${initialStock} units`);

  // 3. Customer Places COD Order (Quantity: 1)
  console.log('Step 1.3: Submitting Customer COD Checkout Order...');
  const customerPhone = `0555${Math.floor(100000 + Math.random() * 900000)}`;
  const orderPayload = {
    idempotencyKey: `smoke-order-${Date.now()}`,
    customer: {
      fullName: 'Yasmine Benali',
      phone: customerPhone,
      wilaya: { code: 16, name: 'Alger' },
      deliveryMethod: 'home',
      address: 'Didouche Mourad, Alger Centre',
      notes: 'Customer smoke test note'
    },
    items: [
      {
        productId: inStockProduct._id,
        colorName: chosenColor.colorName,
        size: chosenSize.size,
        quantity: 1
      }
    ]
  };

  const orderRes = await fetch(`${API_BASE}/orders/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(orderPayload)
  });
  const orderData = await orderRes.json();
  assert(orderData.success, `Checkout failed: ${orderData.message}`);
  const createdOrderCode = orderData.orderCode;
  console.log(`  ✓ Order Submitted Successfully!`);
  console.log(`    Order Code: ${createdOrderCode}`);
  console.log(`    Subtotal: ${orderData.subtotal} DZD | Delivery Fee: ${orderData.deliveryFee} DZD | Total: ${orderData.totalPrice} DZD`);

  // -------------------------------------------------------------
  // PHASE 2: INVENTORY ATOMIC DEDUCTION VERIFICATION
  // -------------------------------------------------------------
  console.log('\n--- [PHASE 2: INVENTORY DEDUCTION & RESTORATION CYCLE] ---');
  
  // Verify stock decreased by 1
  const prodCheck1 = await (await fetch(`${API_BASE}/products/slug/${inStockProduct.slug}`)).json();
  const colorCheck1 = prodCheck1.product.colors.find(c => c.colorName === chosenColor.colorName);
  const sizeCheck1 = colorCheck1.sizes.find(s => s.size === chosenSize.size);
  console.log(`Step 2.1: Verifying atomic stock reduction...`);
  console.log(`    Stock before order: ${initialStock} -> Stock after order: ${sizeCheck1.stock}`);
  assert.strictEqual(sizeCheck1.stock, initialStock - 1, 'Stock did not decrement by 1!');
  console.log(`  ✓ Atomic stock deduction confirmed.`);

  // -------------------------------------------------------------
  // PHASE 3: ADMIN AUTHENTICATION & ORDER MANAGEMENT
  // -------------------------------------------------------------
  console.log('\n--- [PHASE 3: ADMIN MANAGEMENT & DELIVERY EDITING] ---');

  // 1. Admin Login (Sets HttpOnly token cookie, no token in JSON body)
  console.log('Step 3.1: Admin Authenticating...');
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@meryadz.com',
      password: 'MeryaAdmin2026!'
    })
  });
  const loginData = await loginRes.json();
  assert(loginData.success, `Admin login failed: ${loginData.message}`);
  assert.strictEqual(loginData.token, undefined, 'JWT token must NOT be returned in JSON response body');
  
  // Extract session cookie
  const rawSetCookie = loginRes.headers.get('set-cookie') || '';
  const tokenMatch = rawSetCookie.match(/token=([^;]+)/);
  assert(tokenMatch, 'HttpOnly session token cookie was not set in response headers');
  const tokenCookie = tokenMatch[0];

  // Fetch CSRF token
  const csrfRes = await fetch(`${API_BASE}/auth/csrf-token`, {
    headers: { Cookie: tokenCookie }
  });
  const csrfData = await csrfRes.json();
  assert(csrfData.success && csrfData.csrfToken, 'Failed to obtain CSRF token');
  const csrfToken = csrfData.csrfToken;
  const csrfCookieMatch = (csrfRes.headers.get('set-cookie') || '').match(/csrf_token=([^;]+)/);
  const csrfCookie = csrfCookieMatch ? csrfCookieMatch[0] : `csrf_token=${csrfToken}`;

  const adminCookies = `${tokenCookie}; ${csrfCookie}`;
  console.log(`  ✓ Authenticated as ${loginData.admin.username} (${loginData.admin.role}) via HttpOnly cookie & CSRF primed`);

  // 2. Locate order in Admin List
  console.log('Step 3.2: Searching for order in Admin Dashboard...');
  const adminOrderListRes = await fetch(`${API_BASE}/orders/admin?search=${createdOrderCode}`, {
    headers: { Cookie: adminCookies }
  });
  const adminOrderListData = await adminOrderListRes.json();
  assert(adminOrderListData.orders.length > 0, 'Admin could not find newly placed order');
  const dbOrder = adminOrderListData.orders[0];
  console.log(`  ✓ Located order ID: ${dbOrder._id} (Current status: ${dbOrder.status})`);

  // 3. Confirm Order (Pending -> Confirmed)
  console.log('Step 3.3: Advancing status to "Confirmed"...');
  const confirmRes = await fetch(`${API_BASE}/orders/admin/${dbOrder._id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': adminCookies,
      'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({
      status: 'Confirmed',
      note: 'Admin verified phone call with customer'
    })
  });
  const confirmData = await confirmRes.json();
  assert(confirmData.success && confirmData.order.status === 'Confirmed', 'Confirm status change failed');
  console.log(`  ✓ Order status confirmed.`);

  // 4. Edit Delivery Information (Customer requested Change of Wilaya and Agency mode)
  console.log('Step 3.4: Editing Delivery Information (Change Wilaya to Oran & Agency Delivery)...');
  const editDeliveryRes = await fetch(`${API_BASE}/orders/admin/${dbOrder._id}/customer`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': adminCookies,
      'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({
      wilaya: { code: 31, name: 'Oran' },
      deliveryMethod: 'agency',
      agencyName: 'Yalidine Oran Es-Senia',
      address: 'Bureau Yalidine Es-Senia'
    })
  });
  const editDeliveryData = await editDeliveryRes.json();
  assert(editDeliveryData.success, `Edit delivery failed: ${editDeliveryData.message}`);
  console.log(`  ✓ Updated Order Delivery Information:`);
  console.log(`    New Wilaya: ${editDeliveryData.order.customer.wilaya.name} (Code ${editDeliveryData.order.customer.wilaya.code})`);
  console.log(`    New Delivery Mode: ${editDeliveryData.order.customer.deliveryMethod}`);
  console.log(`    Recalculated Delivery Fee: ${editDeliveryData.order.deliveryFee} DZD`);
  console.log(`    Recalculated Order Total: ${editDeliveryData.order.totalPrice} DZD`);
  assert(editDeliveryData.order.totalPrice === editDeliveryData.order.subtotal + editDeliveryData.order.deliveryFee, 'Total price does not match subtotal + deliveryFee');

  // 5. Advance Status: Confirmed -> On the way -> Delivered
  console.log('Step 3.5: Advancing Status: "On the way" -> "Delivered"...');
  await fetch(`${API_BASE}/orders/admin/${dbOrder._id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': adminCookies,
      'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({ status: 'On the way', note: 'Shipped via carrier' })
  });

  const deliverRes = await fetch(`${API_BASE}/orders/admin/${dbOrder._id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': adminCookies,
      'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({ status: 'Delivered', note: 'Customer collected & paid cash' })
  });
  const deliverData = await deliverRes.json();
  assert(deliverData.order.status === 'Delivered', 'Failed to reach Delivered status');
  console.log(`  ✓ Order reached status: "${deliverData.order.status}"`);

  // -------------------------------------------------------------
  // PHASE 4: CUSTOMER PUBLIC ORDER TRACKING
  // -------------------------------------------------------------
  console.log('\n--- [PHASE 4: CUSTOMER ORDER TRACKING LOOKUP] ---');
  console.log('Step 4.1: Customer looking up order via Phone + Order Code...');
  const trackingRes = await fetch(`${API_BASE}/tracking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: customerPhone,
      orderCode: createdOrderCode
    })
  });
  const trackingData = await trackingRes.json();
  assert(trackingData.success, `Tracking failed: ${trackingData.message}`);
  console.log(`  ✓ Public Tracking Retrieved:`);
  console.log(`    Order Code: ${trackingData.order.orderCode}`);
  console.log(`    Status: ${trackingData.order.status}`);
  console.log(`    Customer: ${trackingData.order.customerName}`);
  console.log(`    Wilaya: ${trackingData.order.wilaya}`);
  assert.strictEqual(trackingData.order.status, 'Delivered');

  // -------------------------------------------------------------
  // PHASE 5: INVENTORY ROUND-TRIP (CANCEL -> RESTORE -> REACTIVATE)
  // -------------------------------------------------------------
  console.log('\n--- [PHASE 5: INVENTORY CANCELLATION RESTORATION & REACTIVATION] ---');
  
  // Create a second test order specifically for cancellation & reactivation
  console.log('Step 5.1: Placing second order for inventory cancellation test...');
  const secondOrderRes = await fetch(`${API_BASE}/orders/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `cancel-test-${Date.now()}`,
      customer: {
        fullName: 'Amina Test',
        phone: '0555999888',
        wilaya: { code: 9, name: 'Blida' },
        deliveryMethod: 'home',
        address: 'Centre Ville Blida'
      },
      items: [
        {
          productId: inStockProduct._id,
          colorName: chosenColor.colorName,
          size: chosenSize.size,
          quantity: 2
        }
      ]
    })
  });
  const secondOrder = (await secondOrderRes.json());
  assert(secondOrder.success);
  console.log(`  ✓ Second order created (Code: ${secondOrder.orderCode}, 2 units ordered).`);

  // Check stock after ordering 2 units
  const stockAfterSecond = (await (await fetch(`${API_BASE}/products/slug/${inStockProduct.slug}`)).json())
    .product.colors.find(c => c.colorName === chosenColor.colorName)
    .sizes.find(s => s.size === chosenSize.size).stock;
  console.log(`    Stock after 2 units ordered: ${stockAfterSecond}`);

  // Fetch admin order ID for second order
  const secondAdminOrder = (await (await fetch(`${API_BASE}/orders/admin?search=${secondOrder.orderCode}`, {
    headers: { Cookie: adminCookies }
  })).json()).orders[0];

  // Cancel Order -> Verify stock restores exactly once
  console.log('Step 5.2: Cancelling order -> Verifying stock restores exactly once...');
  await fetch(`${API_BASE}/orders/admin/${secondAdminOrder._id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': adminCookies,
      'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({ status: 'Cancelled', note: 'Customer cancelled before dispatch' })
  });

  const stockAfterCancel = (await (await fetch(`${API_BASE}/products/slug/${inStockProduct.slug}`)).json())
    .product.colors.find(c => c.colorName === chosenColor.colorName)
    .sizes.find(s => s.size === chosenSize.size).stock;
  console.log(`    Stock after cancellation: ${stockAfterCancel} (restored +2 units)`);
  assert.strictEqual(stockAfterCancel, stockAfterSecond + 2, 'Stock was not restored upon cancellation!');

  // Second cancel call to verify idempotency (does not double-restore stock)
  console.log('Step 5.3: Testing cancellation idempotency (no double-restore)...');
  await fetch(`${API_BASE}/orders/admin/${secondAdminOrder._id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': adminCookies,
      'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({ status: 'Cancelled', note: 'Duplicate cancel call' })
  });
  const stockAfterDuplicateCancel = (await (await fetch(`${API_BASE}/products/slug/${inStockProduct.slug}`)).json())
    .product.colors.find(c => c.colorName === chosenColor.colorName)
    .sizes.find(s => s.size === chosenSize.size).stock;
  assert.strictEqual(stockAfterDuplicateCancel, stockAfterCancel, 'Duplicate cancellation corrupted stock with double restoration!');
  console.log(`  ✓ Cancellation stock restoration is strictly idempotent.`);

  // Reactivate order: Cancelled -> Confirmed -> Stock safely re-deducted
  console.log('Step 5.4: Reactivating cancelled order (Cancelled -> Confirmed)...');
  await fetch(`${API_BASE}/orders/admin/${secondAdminOrder._id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': adminCookies,
      'X-CSRF-Token': csrfToken
    },
    body: JSON.stringify({ status: 'Confirmed', note: 'Customer changed mind and re-opened order' })
  });

  const stockAfterReactivation = (await (await fetch(`${API_BASE}/products/slug/${inStockProduct.slug}`)).json())
    .product.colors.find(c => c.colorName === chosenColor.colorName)
    .sizes.find(s => s.size === chosenSize.size).stock;
  console.log(`    Stock after reactivation: ${stockAfterReactivation} (-2 units re-deducted)`);
  assert.strictEqual(stockAfterReactivation, stockAfterCancel - 2, 'Stock was not safely re-deducted upon reactivation!');
  console.log(`  ✓ Stock safely deducted again upon reactivation.`);

  console.log('\n================================================================');
  console.log('  ALL END-TO-END SMOKE FLOWS TESTED AND VERIFIED SUCCESSFULLY!  ');
  console.log('================================================================\n');
}

runCompleteSmokeTest().catch(err => {
  console.error('\n[SMOKE TEST FAILURE]:', err);
  process.exit(1);
});
