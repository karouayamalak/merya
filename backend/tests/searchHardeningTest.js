/**
 * searchHardeningTest.js
 *
 * Verifies that the public and admin product search endpoints are hardened against:
 * - Regex metacharacter injection
 * - Excessively long search strings
 * - NaN / Infinity / negative minPrice and maxPrice
 * - Missing / invalid numeric query params
 */

import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { getProducts, getAllProductsAdmin } from '../src/controllers/productController.js';

dotenv.config();
const DB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0&directConnection=true';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

function mockReq(query = {}) {
  return { query };
}

let passCount = 0;
function pass(msg) {
  console.log(`  ✓ ${msg}`);
  passCount++;
}

async function run() {
  console.log('=== RUNNING SEARCH HARDENING TEST SUITE ===');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(DB_URI);
  }

  // -------------------------------------------------------
  // Public getProducts endpoint
  // -------------------------------------------------------

  // Test 1: Regex injection characters do NOT throw (are safely escaped)
  const regexInjectionRes = mockRes();
  await getProducts(
    mockReq({ search: '.*+?^${}()|[\\' }),
    regexInjectionRes,
    (err) => { if (err) throw err; }
  );
  assert.strictEqual(regexInjectionRes.statusCode, 200, 'Regex injection in search must not crash the server (returns empty results safely)');
  assert(regexInjectionRes.body.success === true, 'Response must be success:true');
  pass('1. Regex metacharacter injection in public search is safely handled (no crash)');

  // Test 2: Very long search string (> 200 chars) is capped, not an error
  const longSearch = 'a'.repeat(500);
  const longSearchRes = mockRes();
  await getProducts(
    mockReq({ search: longSearch }),
    longSearchRes,
    (err) => { if (err) throw err; }
  );
  assert.strictEqual(longSearchRes.statusCode, 200, 'Long search string must not crash (capped internally)');
  pass('2. Excessively long search string (500 chars) is handled safely (capped to 200)');

  // Test 3: minPrice NaN is rejected with 400
  const nanMinRes = mockRes();
  await getProducts(
    mockReq({ minPrice: 'not-a-number' }),
    nanMinRes,
    (err) => { if (err) throw err; }
  );
  assert.strictEqual(nanMinRes.statusCode, 400, 'NaN minPrice must return 400');
  assert(nanMinRes.body.message.includes('minPrice'), 'Error message must reference minPrice');
  pass('3. NaN minPrice rejected with 400');

  // Test 4: maxPrice Infinity is rejected with 400
  const infMaxRes = mockRes();
  await getProducts(
    mockReq({ maxPrice: 'Infinity' }),
    infMaxRes,
    (err) => { if (err) throw err; }
  );
  assert.strictEqual(infMaxRes.statusCode, 400, 'Infinity maxPrice must return 400');
  pass('4. Infinity maxPrice rejected with 400');

  // Test 5: Negative minPrice is rejected with 400
  const negMinRes = mockRes();
  await getProducts(
    mockReq({ minPrice: '-100' }),
    negMinRes,
    (err) => { if (err) throw err; }
  );
  assert.strictEqual(negMinRes.statusCode, 400, 'Negative minPrice must return 400');
  pass('5. Negative minPrice rejected with 400');

  // Test 6: Valid numeric price filters pass through
  const validPriceRes = mockRes();
  await getProducts(
    mockReq({ minPrice: '1000', maxPrice: '5000' }),
    validPriceRes,
    (err) => { if (err) throw err; }
  );
  assert.strictEqual(validPriceRes.statusCode, 200, 'Valid price range must return 200');
  pass('6. Valid minPrice/maxPrice numeric filters accepted (returns 200)');

  // -------------------------------------------------------
  // Admin getAllProductsAdmin endpoint
  // -------------------------------------------------------

  // Test 7: Regex injection in admin search is also safely escaped
  const adminRegexInjRes = mockRes();
  await getAllProductsAdmin(
    mockReq({ search: '(.*)(a+)+$' }),
    adminRegexInjRes,
    (err) => { if (err) throw err; }
  );
  assert.strictEqual(adminRegexInjRes.statusCode, 200, 'Admin regex injection must not crash');
  assert(adminRegexInjRes.body.success === true);
  pass('7. Admin search regex injection safely handled (no crash)');

  // Test 8: Empty search is fine (no filter applied)
  const emptySearchRes = mockRes();
  await getProducts(
    mockReq({ search: '   ' }),
    emptySearchRes,
    (err) => { if (err) throw err; }
  );
  assert.strictEqual(emptySearchRes.statusCode, 200, 'Whitespace-only search returns all products');
  pass('8. Whitespace-only search returns all results without error');

  console.log(`\n=== ALL ${passCount} SEARCH HARDENING TESTS PASSED! ===`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
