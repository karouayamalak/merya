import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import readline from 'readline';
import { Admin } from '../src/models/Admin.js';
import { Session } from '../src/models/Session.js';

dotenv.config();

const isAtlas = process.argv.includes('--atlas');
const mongoUri = isAtlas
  ? (process.env.MONGODB_ATLAS_URI || process.env.MONGODB_URI)
  : (process.env.MONGODB_URI || process.env.MONGODB_ATLAS_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0&directConnection=true');

if (!mongoUri) {
  console.error('[Error] MONGODB_URI environment variable is missing.');
  process.exit(1);
}

// Filter out flag args like --atlas
const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans.trim());
  }));
}

async function run() {
  try {
    console.log('[Database] Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('[Database] Connected successfully.\n');

    const admins = await Admin.find({}, 'username email role isActive lastLoginAt').lean();

    if (admins.length === 0) {
      console.log('⚠️ No admin accounts found in the database.');
      await mongoose.disconnect();
      process.exit(0);
    }

    console.log('📋 Existing Admin Accounts:');
    console.table(admins.map(a => ({
      Username: a.username,
      Email: a.email,
      Role: a.role,
      Active: a.isActive,
      LastLogin: a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : 'Never'
    })));
    console.log('');

    let targetEmail = args[0];
    let newPassword = args[1];

    if (!targetEmail) {
      if (process.stdin.isTTY) {
        targetEmail = await askQuestion('Enter the email of the admin account to reset: ');
      } else {
        console.log('Usage:');
        console.log('  node scripts/resetAdminPassword.js <admin-email> <new-password>');
        console.log('  npm run reset:admin -- <admin-email> <new-password>');
        await mongoose.disconnect();
        process.exit(0);
      }
    }

    if (!targetEmail) {
      console.error('❌ Email is required.');
      await mongoose.disconnect();
      process.exit(1);
    }

    const normalizedEmail = targetEmail.toLowerCase().trim();
    let admin = await Admin.findOne({ email: normalizedEmail });
    if (!admin && normalizedEmail === 'marouataileb3@gmail.com') {
      admin = await Admin.findOne({ role: 'owner' }) || await Admin.findOne({ email: 'admin@meryadz.com' });
      if (admin) {
        console.log(`ℹ️ Linking ${targetEmail} to Store Owner account (${admin.email})`);
      }
    }
    if (!admin) {
      console.error(`❌ Admin account with email "${targetEmail}" was not found.`);
      await mongoose.disconnect();
      process.exit(1);
    }

    if (!newPassword) {
      if (process.stdin.isTTY) {
        newPassword = await askQuestion(`Enter new password for ${admin.email} (min 8 characters): `);
      } else {
        console.error('❌ New password argument is required.');
        await mongoose.disconnect();
        process.exit(1);
      }
    }

    if (!newPassword || newPassword.length < 8) {
      console.error('❌ New password must be at least 8 characters long.');
      await mongoose.disconnect();
      process.exit(1);
    }

    console.log(`\n⏳ Hashing password and updating account for ${admin.email}...`);
    const salt = await bcrypt.genSalt(12);
    admin.passwordHash = await bcrypt.hash(newPassword, salt);
    admin.isActive = true; // Ensure account is active
    admin.resetPasswordOtpHash = null;
    admin.resetPasswordExpires = null;
    admin.resetPasswordAttempts = 0;
    await admin.save();

    // Revoke previous active sessions for security
    const revoked = await Session.updateMany(
      { adminId: admin._id, revokedAt: null },
      { $set: { revokedAt: new Date(), revokeReason: 'LOGOUT_ALL' } }
    );

    console.log(`✅ Success! Password for "${admin.email}" has been reset.`);
    console.log(`🔒 Revoked ${revoked.modifiedCount} active session(s) across existing devices.`);
    console.log('👉 You or your client can now log in at the admin portal with this new password.\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ An error occurred:', error.message);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

run();
