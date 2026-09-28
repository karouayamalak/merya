import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { Admin } from '../src/models/Admin.js';
import { changePassword } from '../src/controllers/authController.js';
import { changePasswordSchema } from '../src/middleware/validation/auth.js';

dotenv.config();

const TEST_DB = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/merya_dz';

describe('Admin Change Password Unit & Security Tests', () => {
  let dbConnected = false;
  let testAdmin;
  const initialPassword = 'InitialSecurePassword2026!';
  const newPassword = 'NewUltraSecurePassword2026!';

  before(async () => {
    try {
      await mongoose.connect(TEST_DB, { serverSelectionTimeoutMS: 2000 });
      dbConnected = true;

      await Admin.deleteOne({ email: 'password_unit_test@meryadz.com' });
      const passwordHash = await bcrypt.hash(initialPassword, 12);
      testAdmin = await Admin.create({
        username: 'Password Unit Tester',
        email: 'password_unit_test@meryadz.com',
        passwordHash,
        role: 'owner',
        isActive: true
      });
    } catch {
      dbConnected = false;
    }
  });

  after(async () => {
    if (dbConnected && mongoose.connection.readyState !== 0) {
      if (testAdmin?._id) {
        await Admin.deleteOne({ _id: testAdmin._id });
      }
      await mongoose.disconnect();
    }
  });

  test('Validation schema rejects short new passwords (< 8 chars)', () => {
    const result = changePasswordSchema.safeParse({
      oldPassword: 'SomePassword123',
      newPassword: 'short'
    });
    assert.strictEqual(result.success, false);
  });

  test('Validation schema rejects missing old password', () => {
    const result = changePasswordSchema.safeParse({
      oldPassword: '',
      newPassword: 'ValidLongNewPassword2026!'
    });
    assert.strictEqual(result.success, false);
  });

  test('Validation schema accepts valid old and new passwords', () => {
    const result = changePasswordSchema.safeParse({
      oldPassword: 'ValidOldPassword123!',
      newPassword: 'ValidNewPassword2026!'
    });
    assert.strictEqual(result.success, true);
  });

  test('Controller rejects request if oldPassword equals newPassword', async () => {
    const req = {
      admin: { _id: new mongoose.Types.ObjectId() },
      body: { oldPassword: 'IdenticalPassword123!', newPassword: 'IdenticalPassword123!' }
    };
    let statusCode = 200;
    let responseData = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      }
    };

    await changePassword(req, res, () => {});
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(responseData.success, false);
    assert.match(responseData.message, /different/i);
  });

  test('Controller rejects request if current password is wrong', async () => {
    if (!dbConnected) return;

    const req = {
      admin: { _id: testAdmin._id },
      body: { oldPassword: 'WrongInitialPassword123!', newPassword }
    };
    let statusCode = 200;
    let responseData = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      }
    };

    await changePassword(req, res, () => {});
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(responseData.success, false);
    assert.match(responseData.message, /incorrect/i);
  });

  test('Controller successfully updates password with correct credentials', async () => {
    if (!dbConnected) return;

    const req = {
      admin: { _id: testAdmin._id },
      authSession: { _id: new mongoose.Types.ObjectId() },
      body: { oldPassword: initialPassword, newPassword }
    };
    let statusCode = 200;
    let responseData = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      }
    };

    await changePassword(req, res, () => {});
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(responseData.success, true);

    // Verify in database that new password matches and old password fails
    const updated = await Admin.findById(testAdmin._id);
    const oldMatches = await updated.comparePassword(initialPassword);
    const newMatches = await updated.comparePassword(newPassword);

    assert.strictEqual(oldMatches, false, 'Old password should no longer match');
    assert.strictEqual(newMatches, true, 'New password must match');
  });
});
