/**
 * runAllTests.js
 *
 * Truthful, comprehensive test runner for the MERYA DZ backend test suite.
 * Executes all test files sequentially, captures exit codes and timing,
 * and prints an honest, transparent execution report.
 */

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');

const testDbUri = process.env.MONGODB_TEST_URI || process.env.MONGODB_LOCAL_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0&directConnection=true';

let spawnedServer = null;
async function ensureServerRunning() {
  try {
    const res = await fetch('http://127.0.0.1:5000/health', { signal: AbortSignal.timeout(1000) });
    if (res.ok) return;
  } catch {}

  console.log('[Runner] Server not detected on http://localhost:5000. Spawning test server...');
  spawnedServer = spawn(process.execPath, ['src/server.js'], {
    cwd: backendRoot,
    stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'test', MONGODB_URI: testDbUri }
  });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:5000/health', { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        console.log('[Runner] Test server ready on http://localhost:5000.\n');
        return;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  console.warn('[Runner] Warning: server did not become healthy within 15s. Continuing tests...\n');
}

const testSuite = [
  { name: 'businessLogic.test.js', isNodeTest: true, desc: 'Core business logic & inventory unit tests' },
  { name: 'priceConsistency.test.js', isNodeTest: true, desc: 'Price consistency, cart pagination, delivery hardening & overrides' },
  { name: 'deliveryFeeIntegrityTest.js', isNodeTest: false, desc: 'Delivery fee fallback, tamper prevention & matrix (A-I)' },
  { name: 'integerMoneyTest.js', isNodeTest: false, desc: 'Integer DZD money validation, models, controllers & DB' },
  { name: 'lineItemAndSessionRevocationTest.js', isNodeTest: false, desc: 'Admin line-item editing & JWT session revocation' },
  { name: 'adminOrderEditConcurrencyTest.js', isNodeTest: false, desc: 'Admin order editing concurrency & destination protection' },
  { name: 'csrfAndSecurityTest.js', isNodeTest: false, desc: 'CSRF double-submit, cookie-only JWT, origin checks' },
  { name: 'secondGapAuditTest.js', isNodeTest: false, desc: '58 Wilayas, delivery settings, rate limiting, snapshots' },
  { name: 'finalAdversarialAudit.js', isNodeTest: false, desc: 'Adversarial security, role checks, variant isolation' },
  { name: 'completeJourneyAudit.js', isNodeTest: false, desc: 'Storefront journey, cart, checkout, tracking audit' },
  { name: 'completeE2ESmoke.js', isNodeTest: false, desc: 'Full E2E smoke test from checkout to delivery' },
  { name: 'transactionCommitUncertaintyTest.js', isNodeTest: false, desc: 'Transaction commit uncertainty & retry recovery' },
  { name: 'transactionRetryTest.js', isNodeTest: false, desc: 'Transaction retry with backoff on transient conflicts' },
  { name: 'checkoutTransactionTest.js', isNodeTest: false, desc: 'Checkout concurrency, idempotency & rollback atomicity' },
  { name: 'inventoryAdjustmentAuditTest.js', isNodeTest: false, desc: 'Inventory manual adjustment audit trail & fail-closed' },
  { name: 'inventoryHardeningTest.js', isNodeTest: false, desc: 'Inventory concurrency conflict & stock integrity' },
  { name: 'concurrencyTest.js', isNodeTest: false, desc: 'High concurrency 10x checkout against 1 unit' },
  { name: 'lifecycleTest.js', isNodeTest: false, desc: 'Order lifecycle state transitions & stock restoration' },
  { name: 'multiItemInventoryTest.js', isNodeTest: false, desc: 'Multi-item inventory operations & terminal state checks' },
  { name: 'rollbackRaceTest.js', isNodeTest: false, desc: 'Rollback race condition & partial state prevention' },
  { name: 'securityVerification.js', isNodeTest: false, desc: 'Security guards, JWT secrets, environment startup' },
  { name: 'statusConcurrencyTest.js', isNodeTest: false, desc: 'Simultaneous status transitions & return/deduct concurrency' },
  { name: 'websocketReconnectResubscriptionTest.js', isNodeTest: false, desc: 'WebSocket reconnect, auto-resubscription & timer deduplication' },
  { name: 'e2eVerification.js', isNodeTest: false, desc: 'E2E verification with WebSocket push notification' },
  { name: 'promotionsAndWilayas58Test.js', isNodeTest: false, desc: '58-Wilaya boundary checks, promotions lifecycle & historical price protection' },
  { name: 'multilingualContentTest.js', isNodeTest: false, desc: 'Dynamic multilingual content (FR/AR/EN), banners, search, and migration' },
  { name: 'multilingualPublishingTest.js', isNodeTest: false, desc: 'Strict multilingual publishing enforcement for products, categories, and banners' },
  { name: 'searchHardeningTest.js', isNodeTest: false, desc: 'Search endpoint hardening: regex escaping, NaN price rejection, length caps' },
  { name: 'productionHardeningFinalPass.test.js', isNodeTest: true, desc: 'Production hardening final pass: images, idempotency, delivery, WS, 58 Wilayas' },
  { name: 'authoritativeDeliverySourceOfTruth.test.js', isNodeTest: true, desc: 'Authoritative delivery pricing source of truth: wilayaRates vs legacy global fees' },
  { name: 'productionTenOutOfTenHardening.test.js', isNodeTest: true, desc: '10/10 Hardening: variant stock overwrite race guard, translation activation, price override audit' },
  { name: 'rateLimiterAdversarial.test.js', isNodeTest: true, desc: 'Rate limiter adversarial suite: namespaces, expired record reset, bounded memory' },
  { name: 'inventoryConcurrencyAdversarial.test.js', isNodeTest: true, desc: 'Inventory concurrency adversarial suite: 16 race scenarios, CAS, and 409 conflict' },
  { name: 'multiDeviceSessionAuth.test.js', isNodeTest: false, desc: 'Multi-device session auth, access/refresh tokens, rotation & revocation' }
];

console.log('================================================================');
console.log('       MERYA DZ — FULL PRODUCTION TEST SUITE RUNNER            ');
console.log('================================================================');
console.log(`Executing ${testSuite.length} test suites sequentially...\n`);

await ensureServerRunning();

const results = [];
let passedCount = 0;
let failedCount = 0;

const totalStart = Date.now();

for (let i = 0; i < testSuite.length; i++) {
  const item = testSuite[i];
  const testPath = path.join('tests', item.name);
  const args = item.isNodeTest ? ['--test', testPath] : [testPath];

  process.stdout.write(`[${i + 1}/${testSuite.length}] Running ${item.name} ... `);
  const start = Date.now();

  const child = spawnSync(process.execPath, args, {
    cwd: backendRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', MONGODB_URI: testDbUri },
    timeout: 60000 // 60s per test file max
  });

  const durationMs = Date.now() - start;
  const isPass = child.status === 0;

  if (isPass) {
    console.log(`✓ PASSED (${(durationMs / 1000).toFixed(2)}s)`);
    passedCount++;
  } else {
    console.log(`✗ FAILED (exit code ${child.status}, ${(durationMs / 1000).toFixed(2)}s)`);
    if (child.stderr) {
      console.log(`   stderr: ${child.stderr.slice(0, 300)}`);
    } else if (child.stdout) {
      console.log(`   stdout excerpt: ${child.stdout.slice(-300)}`);
    }
    failedCount++;
  }

  results.push({
    index: i + 1,
    file: item.name,
    desc: item.desc,
    passed: isPass,
    exitCode: child.status,
    durationMs
  });
}

const totalDurationMs = Date.now() - totalStart;

console.log('\n================================================================');
console.log('                 FINAL TEST EXECUTION REPORT                    ');
console.log('================================================================\n');

console.log('| # | Test File | Description | Result | Duration |');
console.log('|---|---|---|---|---|');
for (const r of results) {
  const statusIcon = r.passed ? '✓ PASS' : `✗ FAIL (${r.exitCode})`;
  console.log(`| ${r.index} | \`${r.file}\` | ${r.desc} | ${statusIcon} | ${(r.durationMs / 1000).toFixed(2)}s |`);
}

console.log('\n----------------------------------------------------------------');
console.log(`Total Test Files: ${testSuite.length}`);
console.log(`Passed:           ${passedCount}`);
console.log(`Failed:           ${failedCount}`);
console.log(`Total Duration:   ${(totalDurationMs / 1000).toFixed(2)}s`);
console.log('================================================================\n');

if (spawnedServer) {
  try {
    spawnedServer.kill();
  } catch {}
}

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
