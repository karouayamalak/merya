import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { execSync, spawn } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

console.log('=== RUNNING TARGETED SECURITY & ENVIRONMENT VERIFICATION ===\n');

// 1. Verify that backend refuses to start in production if ACCESS_TOKEN_SECRET is missing
console.log('[Test 1] Testing production fail-safe startup when ACCESS_TOKEN_SECRET is missing...');
try {
  const result = execSync('node -e "process.env.NODE_ENV=\'production\'; process.env.ACCESS_TOKEN_SECRET=\'\'; import(\'./src/server.js\');"', {
    cwd: process.cwd(),
    stdio: 'pipe',
    timeout: 20000
  });
  assert.fail('Server should have exited with failure when ACCESS_TOKEN_SECRET was missing in production');
} catch (err) {
  const stderr = err.stderr ? err.stderr.toString() : '';
  const stdout = err.stdout ? err.stdout.toString() : '';
  const combined = stderr + stdout;
  assert(combined.includes('FATAL ERROR') && combined.includes('ACCESS_TOKEN_SECRET'), `Expected fatal error message about missing ACCESS_TOKEN_SECRET, got: ${combined} (err: ${err.message})`);
  console.log('  PASS: Backend correctly refused to start and exited safely.');
}

// 2. Verify that backend refuses to start in production if REFRESH_TOKEN_SECRET is missing
console.log('\n[Test 2] Testing production fail-safe startup when REFRESH_TOKEN_SECRET is missing...');
try {
  execSync('node -e "process.env.NODE_ENV=\'production\'; process.env.ACCESS_TOKEN_SECRET=\'test_access_secret_key\'; process.env.REFRESH_TOKEN_SECRET=\'\'; import(\'./src/server.js\');"', {
    cwd: process.cwd(),
    stdio: 'pipe',
    timeout: 20000
  });
  assert.fail('Server should have exited with failure when REFRESH_TOKEN_SECRET was missing in production');
} catch (err) {
  const stderr = err.stderr ? err.stderr.toString() : '';
  const stdout = err.stdout ? err.stdout.toString() : '';
  const combined = stderr + stdout;
  assert(combined.includes('FATAL ERROR') && combined.includes('REFRESH_TOKEN_SECRET'), `Expected fatal error message about missing REFRESH_TOKEN_SECRET, got: ${combined} (err: ${err.message})`);
  console.log('  PASS: Backend correctly refused to start when REFRESH_TOKEN_SECRET missing in production.');
}

// 3. Verify that tokens signed with the OLD shared secret approach are REJECTED
console.log('\n[Test 3] Testing that independent secrets are enforced...');
const OLD_SHARED_SECRET = 'merya_dz_super_secure_jwt_secret_key_prod_2026_algeria_taupe';
const CURRENT_ACCESS_SECRET = process.env.ACCESS_TOKEN_SECRET;
const CURRENT_REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET;

assert(CURRENT_ACCESS_SECRET, 'process.env.ACCESS_TOKEN_SECRET must be defined in environment');
assert(CURRENT_REFRESH_SECRET, 'process.env.REFRESH_TOKEN_SECRET must be defined in environment');
assert.notStrictEqual(CURRENT_ACCESS_SECRET, OLD_SHARED_SECRET, 'Current ACCESS_TOKEN_SECRET must NOT equal the old shared secret');
assert.notStrictEqual(CURRENT_REFRESH_SECRET, OLD_SHARED_SECRET, 'Current REFRESH_TOKEN_SECRET must NOT equal the old shared secret');

// Verify that a token signed with the old shared secret is rejected by both access and refresh verification
import { verifyAccessToken, verifyRefreshToken } from '../src/utils/tokenUtils.js';

try {
  const oldForgedToken = jwt.sign({ id: '65f000000000000000000001', role: 'owner', username: 'forged_attacker' }, OLD_SHARED_SECRET, { expiresIn: '1h' });
  verifyAccessToken(oldForgedToken);
  assert.fail('Old shared-secret token should have been rejected by access verification!');
} catch (err) {
  assert.strictEqual(err.name, 'JsonWebTokenError', 'Old fallback token should have been rejected (invalid signature)');
  console.log('  PASS: Access token signed with old shared secret successfully REJECTED.');
}

// 4. Verify that invalid/malformed tokens are REJECTED
console.log('\n[Test 4] Testing rejection of malformed tokens...');
try {
  jwt.verify('malformed.token.payload', CURRENT_ACCESS_SECRET);
  assert.fail('Malformed token should have failed verification!');
} catch (err) {
  assert.strictEqual(err.name, 'JsonWebTokenError');
  console.log('  PASS: Malformed token correctly rejected.');
}

// 5. Verify that valid token signed with current rotated secret SUCCEEDS
console.log('\n[Test 5] Testing verification with new rotated production secrets...');
const validToken = jwt.sign({ id: '65f000000000000000000001', role: 'owner', username: 'valid_admin' }, CURRENT_ACCESS_SECRET, { expiresIn: '1h' });
const decoded = jwt.verify(validToken, CURRENT_ACCESS_SECRET);
assert.strictEqual(decoded.username, 'valid_admin');
console.log('  PASS: Valid access token signed with rotated secret decoded successfully.');

// 6. Verify that the two secrets are genuinely independent (not derived from each other)
console.log('\n[Test 6] Verifying access and refresh secrets are independent...');
assert.notStrictEqual(CURRENT_ACCESS_SECRET, CURRENT_REFRESH_SECRET, 'ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET must be genuinely independent');
// Verify that a refresh token signed with the access secret is rejected
try {
  const wrongToken = jwt.sign({ sub: '65f000000000000000000001', sid: 'sid', type: 'refresh', jti: 'jti' }, CURRENT_ACCESS_SECRET, { expiresIn: '7d' });
  verifyRefreshToken(wrongToken);
  assert.fail('Refresh token signed with access secret should be rejected');
} catch (err) {
  assert.strictEqual(err.name, 'JsonWebTokenError');
  console.log('  PASS: Refresh token signed with access secret correctly REJECTED (secrets are independent).');
}

console.log('\n=== ALL SECURITY VERIFICATION CHECKS PASSED PERFECTLY ===\n');
process.exit(0);
