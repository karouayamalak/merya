import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';

dotenv.config();

const BASE = 'http://localhost:5000/api/v1';
let adminCookies = '';
let csrfToken = '';
let testProductId;
const testColorName = 'Noir';
const testSizeName = 'M';

/**
 * Helper: make an authenticated admin HTTP request using cookie + CSRF.
 * Safe methods (GET) do not send CSRF token.
 */
async function req(method, path, body, cookies, csrf) {
  const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
  const headers = {
    'Content-Type': 'application/json',
    ...(cookies ? { Cookie: cookies } : {}),
    ...(isMutating && csrf ? { 'X-CSRF-Token': csrf } : {})
  };
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, headers: res.headers, body: json };
}

function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { console.error('  ✗ FAIL: ' + msg); process.exitCode = 1; }

async function connect() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('Connected to MongoDB.');
}

/**
 * Login via HTTP (cookie-based), then fetch CSRF token.
 * Returns { adminCookies, csrfToken }.
 */
async function adminLogin() {
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.INITIAL_ADMIN_EMAIL,
      password: process.env.INITIAL_ADMIN_PASSWORD
    })
  });
  if (loginRes.status !== 200) throw new Error('Admin login failed: ' + loginRes.status);

  const setCookieRaw = loginRes.headers.get('set-cookie') || '';
  const tokenMatch = setCookieRaw.match(/token=([^;]+)/);
  if (!tokenMatch) throw new Error('No token cookie in login response');
  const tokenCookiePart = tokenMatch[0]; // "token=<value>"

  // Fetch CSRF token
  const csrfRes = await fetch(`${BASE}/auth/csrf-token`, {
    headers: { Cookie: tokenCookiePart }
  });
  if (csrfRes.status !== 200) throw new Error('CSRF token fetch failed: ' + csrfRes.status);
  const csrfData = await csrfRes.json();
  const csrf = csrfData.csrfToken;
  const csrfCookieRaw = csrfRes.headers.get('set-cookie') || '';
  const csrfCookieMatch = csrfCookieRaw.match(/csrf_token=([^;]+)/);
  const csrfCookiePart = csrfCookieMatch ? csrfCookieMatch[0] : `csrf_token=${csrf}`;

  return {
    adminCookies: `${tokenCookiePart}; ${csrfCookiePart}`,
    csrfToken: csrf
  };
}

async function ensureCategory() {
  let cat = await Category.findOne({ slug: 'inv-hardening-test-cat' });
  if (!cat) {
    cat = await Category.create({
      name: 'Inv Hardening Test Cat',
      slug: 'inv-hardening-test-cat',
      image: 'https://example.com/cat.jpg'
    });
  }
  return cat._id.toString();
}

// === Test 1: createProduct strips client stock ===
async function test1_createProductStripsStock() {
  console.log('');
  console.log('=== Test 1: createProduct stock=50/99 => all variants must be 0 ===');
  const catId = await ensureCategory();
  const r = await req('POST', '/products', {
    name: 'Inv Hardening Product ' + Date.now(),
    description: 'Inventory hardening test product',
    category: catId, sellingPrice: 1500, costPrice: 800,
    colors: [{
      colorName: testColorName, colorCode: '#000000',
      images: ['https://example.com/img.jpg'],
      sizes: [{ size: testSizeName, stock: 50 }, { size: 'L', stock: 99 }]
    }]
  }, adminCookies, csrfToken);
  if (r.status !== 201) { fail('Expected 201, got ' + r.status + ': ' + JSON.stringify(r.body)); return; }
  testProductId = r.body.product._id;
  const colorObj = r.body.product.colors && r.body.product.colors.find(c => c.colorName === testColorName);
  const sizeM = colorObj && colorObj.sizes && colorObj.sizes.find(s => s.size === testSizeName);
  const sizeL = colorObj && colorObj.sizes && colorObj.sizes.find(s => s.size === 'L');
  (sizeM && sizeM.stock === 0) ? pass('Size M stock=0 (50 stripped)') : fail('Size M stock=' + (sizeM && sizeM.stock) + ' NOT stripped');
  (sizeL && sizeL.stock === 0) ? pass('Size L stock=0 (99 stripped)') : fail('Size L stock=' + (sizeL && sizeL.stock) + ' NOT stripped');
}

// === Test 2: adjustVariantStock sets stock via inventoryService ===
async function test2_adjustVariantStock() {
  console.log('');
  console.log('=== Test 2: adjustVariantStock(newStock=50) via /orders/admin/inventory/adjust ===');
  const r = await req('POST', '/orders/admin/inventory/adjust', {
    productId: testProductId, colorName: testColorName, size: testSizeName,
    newStock: 50, reason: 'Initial stock setup after product creation'
  }, adminCookies, csrfToken);
  if (r.status !== 200) { fail('Expected 200, got ' + r.status + ': ' + JSON.stringify(r.body)); return; }
  const adj = r.body.adjustment;
  (adj && adj.previousStock === 0) ? pass('previousStock=0') : fail('previousStock=' + (adj && adj.previousStock));
  (adj && adj.newStock === 50)     ? pass('newStock=50')     : fail('newStock=' + (adj && adj.newStock));
  (adj && adj.reason === 'Initial stock setup after product creation') ? pass('reason recorded') : fail('reason=' + (adj && adj.reason));
  const product = await Product.findById(testProductId);
  const color   = product.colors.find(c => c.colorName === testColorName);
  const sz      = color && color.sizes.find(s => s.size === testSizeName);
  (sz && sz.stock === 50) ? pass('DB stock=50') : fail('DB stock=' + (sz && sz.stock));
}

// === Test 3: Concurrent admin adjustments — exactly one wins, one 409 ===
async function test3_concurrentAdminAdjustments() {
  console.log('');
  console.log('=== Test 3: Two simultaneous adjustments (A->15, B->8). One wins, one 409 ===');
  // Set baseline stock=10
  await req('POST', '/orders/admin/inventory/adjust', {
    productId: testProductId, colorName: testColorName, size: testSizeName,
    newStock: 10, reason: 'Baseline'
  }, adminCookies, csrfToken);

  const [rA, rB] = await Promise.all([
    req('POST', '/orders/admin/inventory/adjust', { productId: testProductId, colorName: testColorName, size: testSizeName, newStock: 15, reason: 'Admin A' }, adminCookies, csrfToken),
    req('POST', '/orders/admin/inventory/adjust', { productId: testProductId, colorName: testColorName, size: testSizeName, newStock: 8,  reason: 'Admin B' }, adminCookies, csrfToken)
  ]);

  console.log('  Admin A -> status=' + rA.status + ' newStock=' + (rA.body.adjustment && rA.body.adjustment.newStock));
  console.log('  Admin B -> status=' + rB.status + ' newStock=' + (rB.body.adjustment && rB.body.adjustment.newStock));

  const successes = [rA, rB].filter(r => r.status === 200);
  const conflicts = [rA, rB].filter(r => r.status === 409);

  successes.length === 1 ? pass('Exactly 1 success (200)') : fail('Expected 1 success, got ' + successes.length);
  conflicts.length === 1 ? pass('Exactly 1 conflict (409)') : fail('Expected 1 conflict, got ' + conflicts.length);

  const conflict0body = conflicts[0] && conflicts[0].body;
  (conflict0body && conflict0body.code === 'CONCURRENT_CONFLICT')
    ? pass('409 body code=CONCURRENT_CONFLICT')
    : fail('code wrong: ' + JSON.stringify(conflict0body));

  const finalProduct  = await Product.findById(testProductId);
  const finalColor    = finalProduct.colors.find(c => c.colorName === testColorName);
  const finalSz       = finalColor && finalColor.sizes.find(s => s.size === testSizeName);
  const winner        = successes[0];
  const winnerStock   = winner && winner.body.adjustment && winner.body.adjustment.newStock;

  (finalSz && finalSz.stock === winnerStock)
    ? pass('DB final stock=' + finalSz.stock + ' (no lost update)')
    : fail('DB final stock=' + (finalSz && finalSz.stock) + ' expected=' + winnerStock + ' LOST UPDATE');
}

(async () => {
  try {
    await connect();
    const auth = await adminLogin();
    adminCookies = auth.adminCookies;
    csrfToken = auth.csrfToken;
    await test1_createProductStripsStock();
    await test2_adjustVariantStock();
    await test3_concurrentAdminAdjustments();
    if (testProductId) await Product.findByIdAndDelete(testProductId).catch(() => {});
    await Category.deleteOne({ slug: 'inv-hardening-test-cat' }).catch(() => {});
    console.log('');
    console.log(process.exitCode === 1
      ? '=== INVENTORY HARDENING RESULTS: SOME FAILED ==='
      : '=== INVENTORY HARDENING RESULTS: ALL PASSED ===');
  } catch (err) {
    console.error('Fatal:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
})();
