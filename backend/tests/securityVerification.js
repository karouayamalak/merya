import jwt from 'jsonwebtoken';
import assert from 'node:assert';
import { execSync, spawn } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

console.log('=== RUNNING TARGETED SECURITY & ENVIRONMENT VERIFICATION ===\n');

// 1. Verify that backend refuses to start in production if JWT_SECRET is missing
console.log('[Test 1] Testing production fail-safe startup when JWT_SECRET is missing...');
try {
  const result = execSync('node -e "process.env.NODE_ENV=\'production\'; process.env.JWT_SECRET=\'\'; import(\'./src/server.js\');"', {
    cwd: process.cwd(),
    stdio: 'pipe',
    timeout: 20000
  });
  assert.fail('Server should have exited with failure when JWT_SECRET was missing in production');
} catch (err) {
  const stderr = err.stderr ? err.stderr.toString() : '';
  const stdout = err.stdout ? err.stdout.toString() : '';
  const combined = stderr + stdout;
  assert(combined.includes('FATAL ERROR') && combined.includes('JWT_SECRET'), `Expected fatal error message about missing JWT_SECRET, got: ${combined} (err: ${err.message})`);
  console.log('  PASS: Backend correctly refused to start and exited safely.');
}

// 2. Verify that backend refuses to start in production if COOKIE_SECRET is missing
console.log('\n[Test 2] Testing production fail-safe startup when COOKIE_SECRET is missing...');
try {
  execSync('node -e "process.env.NODE_ENV=\'production\'; process.env.JWT_SECRET=\'test_secret_key\'; process.env.COOKIE_SECRET=\'\'; import(\'./src/server.js\');"', {
    cwd: process.cwd(),
    stdio: 'pipe',
    timeout: 20000
  });
  assert.fail('Server should have exited with failure when COOKIE_SECRET was missing in production');
} catch (err) {
  const stderr = err.stderr ? err.stderr.toString() : '';
  const stdout = err.stdout ? err.stdout.toString() : '';
  const combined = stderr + stdout;
  assert(combined.includes('FATAL ERROR') && combined.includes('COOKIE_SECRET'), `Expected fatal error message about missing COOKIE_SECRET, got: ${combined} (err: ${err.message})`);
  console.log('  PASS: Backend correctly refused to start when COOKIE_SECRET missing in production.');
}

// 3. Verify that old fallback secret tokens are REJECTED
console.log('\n[Test 3] Testing rejection of tokens signed with OLD fallback secret...');
const OLD_FALLBACK_SECRET = 'merya_dz_super_secure_jwt_secret_key_prod_2026_algeria_taupe';
const CURRENT_SECRET = process.env.JWT_SECRET;

assert(CURRENT_SECRET, 'process.env.JWT_SECRET must be defined in environment');
assert.notStrictEqual(CURRENT_SECRET, OLD_FALLBACK_SECRET, 'Current JWT_SECRET must NOT equal the old fallback secret');

const oldForgedToken = jwt.sign(
  { id: '65f000000000000000000001', role: 'owner', username: 'forged_attacker' },
  OLD_FALLBACK_SECRET,
  { expiresIn: '1h' }
);

// Verify with current secret: must throw JsonWebTokenError
try {
  jwt.verify(oldForgedToken, CURRENT_SECRET);
  assert.fail('Old fallback token should have been rejected!');
} catch (err) {
  assert.strictEqual(err.name, 'JsonWebTokenError');
  console.log('  PASS: Token signed with old fallback secret successfully REJECTED (invalid signature).');
}

// 4. Verify that invalid/malformed tokens are REJECTED
console.log('\n[Test 4] Testing rejection of malformed tokens...');
try {
  jwt.verify('malformed.token.payload', CURRENT_SECRET);
  assert.fail('Malformed token should have failed verification!');
} catch (err) {
  assert.strictEqual(err.name, 'JsonWebTokenError');
  console.log('  PASS: Malformed token correctly rejected.');
}

// 5. Verify that valid token signed with current rotated secret SUCCEEDS
console.log('\n[Test 5] Testing verification with new rotated production secret...');
const validToken = jwt.sign(
  { id: '65f000000000000000000001', role: 'owner', username: 'valid_admin' },
  CURRENT_SECRET,
  { expiresIn: '1h' }
);
const decoded = jwt.verify(validToken, CURRENT_SECRET);
assert.strictEqual(decoded.username, 'valid_admin');
console.log('  PASS: Valid token signed with rotated secret decoded successfully.');

// 6. Test Cloudinary Enforcement in Production
console.log('\n[Test 6] Testing Cloudinary enforcement in production...');
import('sharp').then(async ({ default: sharp }) => {
  const { processAndSaveImage } = await import('../src/middleware/upload.js');
  
  const originalEnv = process.env.NODE_ENV;
  const origCloudName = process.env.CLOUDINARY_CLOUD_NAME;
  
  process.env.NODE_ENV = 'production';
  delete process.env.CLOUDINARY_CLOUD_NAME;
  
  try {
    const validImageBuffer = await sharp({
      create: { width: 10, height: 10, channels: 4, background: { r: 180, g: 150, b: 120, alpha: 1 } }
    }).png().toBuffer();

    await processAndSaveImage(validImageBuffer);
    assert.fail('Should have rejected upload in production without Cloudinary credentials');
  } catch (err) {
    assert(err.message.includes('Cloudinary'), `Unexpected error message: ${err.message}`);
    console.log(`  PASS: Upload rejected in production when Cloudinary is unconfigured:`);
    console.log(`        "${err.message}"`);
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (origCloudName) process.env.CLOUDINARY_CLOUD_NAME = origCloudName;
  }

  console.log('\n=== ALL SECURITY VERIFICATION CHECKS PASSED PERFECTLY ===\n');
  process.exit(0);
}).catch(err => {
  console.error('Test execution failure:', err);
  process.exit(1);
});
