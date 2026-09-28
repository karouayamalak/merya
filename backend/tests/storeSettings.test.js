import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { StoreSetting } from '../src/models/StoreSetting.js';
import { getStoreSettings, updateStoreSettings } from '../src/controllers/storeSettingController.js';

dotenv.config();

const TEST_DB = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/merya_dz';

describe('StoreSetting Schema & Controller Logic', () => {
  let dbConnected = false;

  before(async () => {
    try {
      await mongoose.connect(TEST_DB, { serverSelectionTimeoutMS: 2000 });
      dbConnected = true;
    } catch {
      dbConnected = false;
      // Database not locally available in this environment; unit tests will run offline
    }
  });

  after(async () => {
    if (dbConnected && mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  test('StoreSetting schema validates correct fields and defaults', () => {
    const doc = new StoreSetting({
      singletonKey: 'default'
    });
    assert.strictEqual(doc.singletonKey, 'default');
    assert.strictEqual(doc.logoVariant, 'white');
    assert.strictEqual(doc.deliveryNoticeDays, 3);
    assert.strictEqual(doc.socialLinks.facebook, '');
    assert.strictEqual(doc.socialLinks.instagram, '');
    assert.strictEqual(doc.socialLinks.tiktok, '');
  });

  test('StoreSetting schema accepts original logoVariant', () => {
    const doc = new StoreSetting({
      singletonKey: 'default',
      logoVariant: 'original'
    });
    const err = doc.validateSync();
    assert.strictEqual(err, undefined);
    assert.strictEqual(doc.logoVariant, 'original');
  });

  test('StoreSetting schema rejects invalid logoVariant', () => {
    const doc = new StoreSetting({
      singletonKey: 'default',
      logoVariant: 'invalid_color'
    });
    const err = doc.validateSync();
    assert.ok(err, 'Expected validation error');
    assert.ok(err.errors.logoVariant);
  });

  test('StoreSetting schema rejects invalid deliveryNoticeDays', () => {
    const doc = new StoreSetting({
      singletonKey: 'default',
      deliveryNoticeDays: 0 // min is 1
    });
    const err = doc.validateSync();
    assert.ok(err, 'Expected validation error');
    assert.ok(err.errors.deliveryNoticeDays);
  });

  test('updateStoreSettings controller validates logoVariant', async () => {
    const req = {
      body: { logoVariant: 'yellow' }
    };
    let responseStatus = 200;
    let responseData = null;
    const res = {
      status(code) { responseStatus = code; return this; },
      json(data) { responseData = data; return this; }
    };

    await updateStoreSettings(req, res, () => {});
    assert.strictEqual(responseStatus, 400);
    assert.strictEqual(responseData.success, false);
    assert.match(responseData.message, /Invalid logoVariant/);
  });

  test('updateStoreSettings controller validates deliveryNoticeDays', async () => {
    const req = {
      body: { deliveryNoticeDays: 45 }
    };
    let responseStatus = 200;
    let responseData = null;
    const res = {
      status(code) { responseStatus = code; return this; },
      json(data) { responseData = data; return this; }
    };

    await updateStoreSettings(req, res, () => {});
    assert.strictEqual(responseStatus, 400);
    assert.strictEqual(responseData.success, false);
    assert.match(responseData.message, /Invalid deliveryNoticeDays/);
  });

  test('updateStoreSettings controller rejects javascript: URLs in socialLinks', async () => {
    const req = {
      body: {
        socialLinks: {
          facebook: 'javascript:alert(1)'
        }
      }
    };
    let responseStatus = 200;
    let responseData = null;
    const res = {
      status(code) { responseStatus = code; return this; },
      json(data) { responseData = data; return this; }
    };

    await updateStoreSettings(req, res, () => {});
    assert.strictEqual(responseStatus, 400);
    assert.strictEqual(responseData.success, false);
    assert.match(responseData.message, /unsafe protocol/);
  });
});
