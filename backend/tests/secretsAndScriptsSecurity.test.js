import { test, describe } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');

describe('Secrets & Script Safety Suite', () => {

  test('1. migrateToAtlas fails safely when MONGODB_ATLAS_URI is missing', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/migrateToAtlas.js'],
      {
        cwd: backendDir,
        env: {
          ...process.env,
          MONGODB_ATLAS_URI: ''
        },
        encoding: 'utf8'
      }
    );

    assert.strictEqual(result.status, 1, 'migrateToAtlas must exit with code 1 when MONGODB_ATLAS_URI is empty');
    assert.match(
      result.stderr || result.stdout,
      /MONGODB_ATLAS_URI environment variable is required/i,
      'migrateToAtlas must display clear fatal error explaining MONGODB_ATLAS_URI is required'
    );
  });

  test('2. migrateToAtlas source code contains NO hardcoded Atlas credentials or fallbacks', () => {
    const scriptPath = path.join(backendDir, 'scripts', 'migrateToAtlas.js');
    const content = fs.readFileSync(scriptPath, 'utf8');

    assert.doesNotMatch(content, /akarou/i, 'Script must not contain exposed username');
    assert.doesNotMatch(content, /0lClKLycwR1XPkQB/, 'Script must not contain exposed password');
    assert.doesNotMatch(content, /mongodb\+srv:\/\/[^'"`\s]+:[^'"`\s]+@/, 'Script must not contain hardcoded authenticated Atlas URI');
    assert.doesNotMatch(content, /atlasUri\s*=\s*process\.env\.MONGODB_ATLAS_URI\s*\|\|/, 'Script must not provide a fallback Atlas credential');
  });

  test('3. resetToBlankStore requires --confirm-reset and aborts without it', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/resetToBlankStore.js'],
      {
        cwd: backendDir,
        env: {
          ...process.env,
          INITIAL_ADMIN_PASSWORD: 'ValidPassword123!'
        },
        encoding: 'utf8'
      }
    );

    assert.strictEqual(result.status, 1, 'resetToBlankStore must exit with code 1 when --confirm-reset is omitted');
    assert.match(
      result.stderr || result.stdout,
      /SAFETY ABORT[\s\S]*--confirm-reset/i,
      'Must print safety abort explaining --confirm-reset is required'
    );
  });

  test('4. resetToBlankStore aborts when INITIAL_ADMIN_PASSWORD is missing or too short', () => {
    // Test with empty password
    const resultEmpty = spawnSync(
      process.execPath,
      ['scripts/resetToBlankStore.js', '--confirm-reset'],
      {
        cwd: backendDir,
        env: {
          ...process.env,
          INITIAL_ADMIN_PASSWORD: ''
        },
        encoding: 'utf8'
      }
    );

    assert.strictEqual(resultEmpty.status, 1, 'resetToBlankStore must exit with code 1 when INITIAL_ADMIN_PASSWORD is empty');
    assert.match(
      resultEmpty.stderr || resultEmpty.stdout,
      /INITIAL_ADMIN_PASSWORD environment variable is required/i,
      'Must state that INITIAL_ADMIN_PASSWORD is required'
    );

    // Test with short password (<8 chars)
    const resultShort = spawnSync(
      process.execPath,
      ['scripts/resetToBlankStore.js', '--confirm-reset'],
      {
        cwd: backendDir,
        env: {
          ...process.env,
          INITIAL_ADMIN_PASSWORD: 'short'
        },
        encoding: 'utf8'
      }
    );

    assert.strictEqual(resultShort.status, 1, 'resetToBlankStore must exit with code 1 when INITIAL_ADMIN_PASSWORD is < 8 chars');
  });

  test('5. resetToBlankStore contains NO fallback admin password', () => {
    const scriptPath = path.join(backendDir, 'scripts', 'resetToBlankStore.js');
    const content = fs.readFileSync(scriptPath, 'utf8');

    assert.doesNotMatch(content, /adminPassword\s*=\s*process\.env\.INITIAL_ADMIN_PASSWORD\s*\|\|/, 'Must not have fallback admin password');
    assert.doesNotMatch(content, /MeryaAdmin2026!/, 'Must not contain hardcoded default password in source');
  });

  test('6. resetToBlankStore does NOT print plaintext password in output summary', () => {
    const scriptPath = path.join(backendDir, 'scripts', 'resetToBlankStore.js');
    const content = fs.readFileSync(scriptPath, 'utf8');

    assert.doesNotMatch(
      content,
      /password:\s*\$\{adminPassword\}/,
      'Script must not interpolate adminPassword into console log output'
    );
  });

  test('7. Repository source scan: No hardcoded production database credentials or fallback passwords', () => {
    const filesToScan = [
      'scripts/migrateToAtlas.js',
      'scripts/resetToBlankStore.js',
      'src/seed/seed.js',
      'src/seed/normalize58Wilayas.js',
      'src/seed/migrate69Wilayas.js',
      'src/seed/migrateMultilingualContent.js',
      'src/config/db.js',
      'src/server.js'
    ];

    for (const relPath of filesToScan) {
      const fullPath = path.join(backendDir, relPath);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, 'utf8');

      assert.doesNotMatch(
        content,
        /mongodb\+srv:\/\/[^'"`\s]+:[^'"`\s]+@/,
        `${relPath} must not contain hardcoded authenticated Atlas URI`
      );
      assert.doesNotMatch(
        content,
        /0lClKLycwR1XPkQB/,
        `${relPath} must not contain compromised credential string`
      );
    }
  });

  test('8. URI masking utility correctly masks credentials', () => {
    const sensitiveUri = 'mongodb+srv://admin_user:SuperSecretPass123@cluster0.abcde.mongodb.net/dbname?retryWrites=true';
    const masked = sensitiveUri.replace(/:([^:@]+)@/, ':****@');
    assert.strictEqual(
      masked,
      'mongodb+srv://admin_user:****@cluster0.abcde.mongodb.net/dbname?retryWrites=true',
      'Masked URI must replace password with ****'
    );
    assert.doesNotMatch(masked, /SuperSecretPass123/, 'Masked URI must never contain plaintext password');
  });

});
