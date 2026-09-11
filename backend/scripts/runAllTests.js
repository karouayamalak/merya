/**
 * runAllTests.js
 *
 * Truthful, comprehensive test runner for the MERYA DZ backend test suite.
 * Executes all test files sequentially, captures exit codes and timing,
 * and prints an honest, transparent execution report.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');

const testSuite = [
  { name: 'businessLogic.test.js', isNodeTest: true, desc: 'Core business logic & inventory unit tests' },
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
  { name: 'e2eVerification.js', isNodeTest: false, desc: 'E2E verification with WebSocket push notification' }
];

console.log('================================================================');
console.log('       MERYA DZ — FULL PRODUCTION TEST SUITE RUNNER            ');
console.log('================================================================');
console.log(`Executing ${testSuite.length} test suites sequentially...\n`);

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
    env: { ...process.env },
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

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
