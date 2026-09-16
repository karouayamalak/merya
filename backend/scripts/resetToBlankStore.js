import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { Order } from '../src/models/Order.js';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Banner } from '../src/models/Banner.js';
import { InventoryAdjustment } from '../src/models/InventoryAdjustment.js';
import { Admin } from '../src/models/Admin.js';
import { DeliverySetting } from '../src/models/DeliverySetting.js';
import { ALGERIA_WILAYAS, ROLES } from '../src/config/constants.js';

dotenv.config();

const isAtlas = process.argv.includes('--atlas');
const mongoUri = isAtlas
  ? (process.env.MONGODB_ATLAS_URI || process.env.MONGODB_URI)
  : (process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0&directConnection=true');

function getDefaultWilayaRates(code) {
  if (code === 16) return { homeFee: 500, agencyFee: 350 };
  if ([9, 35, 42].includes(code)) return { homeFee: 600, agencyFee: 400 };
  if ([31, 25, 19, 15, 6, 23, 13, 27, 2, 5, 18, 21, 22, 24, 26, 29, 34, 43, 44, 46, 48].includes(code)) return { homeFee: 750, agencyFee: 450 };
  if ([3, 4, 7, 10, 12, 14, 17, 20, 28, 38, 40, 41, 45, 51].includes(code)) return { homeFee: 850, agencyFee: 500 };
  if ([8, 30, 32, 39, 47, 55, 57, 58].includes(code)) return { homeFee: 1000, agencyFee: 700 };
  return { homeFee: 1400, agencyFee: 900 };
}

async function resetToBlankStore() {
  console.log(`[Reset] Connecting to: ${mongoUri.replace(/:([^:@]+)@/, ':****@')}`);
  await mongoose.connect(mongoUri);
  console.log('[Reset] Connected successfully.');

  const db = mongoose.connection.db;

  // 1. Wipe all orders
  const ordersDeleted = await Order.deleteMany({});
  console.log(`[Reset] Deleted ${ordersDeleted.deletedCount} orders.`);

  // 2. Wipe all products
  const productsDeleted = await Product.deleteMany({});
  console.log(`[Reset] Deleted ${productsDeleted.deletedCount} products.`);

  // 3. Wipe all categories
  const categoriesDeleted = await Category.deleteMany({});
  console.log(`[Reset] Deleted ${categoriesDeleted.deletedCount} categories.`);

  // 4. Wipe all banners
  const bannersDeleted = await Banner.deleteMany({});
  console.log(`[Reset] Deleted ${bannersDeleted.deletedCount} banners.`);

  // 5. Wipe all inventory adjustments / audit logs
  const adjustmentsDeleted = await InventoryAdjustment.deleteMany({});
  console.log(`[Reset] Deleted ${adjustmentsDeleted.deletedCount} inventory audit records.`);

  // 6. Wipe rate limit records
  try {
    const rlDeleted = await db.collection('ratelimitrecords').deleteMany({});
    console.log(`[Reset] Cleared ${rlDeleted.deletedCount} rate limit records.`);
  } catch (e) {
    // collection may not exist
  }

  // 7. Clean up test admins and ensure primary admin exists
  const testAdminsDeleted = await Admin.deleteMany({
    email: { $in: ['csrf_test_admin@merya.dz', 'line_item_admin@merya.dz', 'logout_csrf_admin@merya.dz'] }
  });
  console.log(`[Reset] Removed ${testAdminsDeleted.deletedCount} test admin accounts.`);

  const adminEmail = (process.env.INITIAL_ADMIN_EMAIL || 'admin@meryadz.com').toLowerCase();
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'MeryaAdmin2026!';
  const adminUsername = process.env.INITIAL_ADMIN_USERNAME || 'Store Owner';

  let primaryAdmin = await Admin.findOne({ email: adminEmail });
  if (!primaryAdmin) {
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(adminPassword, salt);
    primaryAdmin = await Admin.create({
      username: adminUsername,
      email: adminEmail,
      passwordHash,
      role: ROLES.OWNER,
      isActive: true
    });
    console.log(`[Reset] Created primary admin account: ${adminEmail}`);
  } else {
    // Reset password hash to current INITIAL_ADMIN_PASSWORD
    const salt = await bcrypt.genSalt(12);
    primaryAdmin.passwordHash = await bcrypt.hash(adminPassword, salt);
    primaryAdmin.isActive = true;
    primaryAdmin.role = ROLES.OWNER;
    await primaryAdmin.save();
    console.log(`[Reset] Verified and updated primary admin account: ${adminEmail}`);
  }

  // 8. Ensure DeliverySetting has all 58 canonical Wilayas configured
  const wilayaRates = ALGERIA_WILAYAS.map(w => {
    const d = getDefaultWilayaRates(w.code);
    return {
      wilayaCode: w.code,
      wilayaName: w.name,
      wilayaNameAr: w.nameAr,
      homeFee: d.homeFee,
      agencyFee: d.agencyFee,
      isAvailable: true
    };
  });

  let delSetting = await DeliverySetting.findOne({ singletonKey: 'default' });
  if (!delSetting) {
    await DeliverySetting.create({
      singletonKey: 'default',
      freeDeliveryThreshold: 0,
      wilayaRates
    });
    console.log('[Reset] Configured DeliverySetting singleton with all 58 Wilayas.');
  } else {
    delSetting.wilayaRates = wilayaRates;
    delSetting.freeDeliveryThreshold = 0;
    await delSetting.save();
    console.log('[Reset] DeliverySetting verified with all 58 Wilayas.');
  }

  console.log('\n=== BLANK STORE RESET COMPLETE ===');
  console.log(' Products: 0');
  console.log(' Categories: 0');
  console.log(' Orders: 0');
  console.log(' Banners: 0');
  console.log(' Inventory Adjustments: 0');
  console.log(` Admin Portal: ${adminEmail} (password: ${adminPassword})`);
  console.log(' Delivery Settings: 58 Wilayas authoritative rates ready');
  console.log('===================================\n');

  await mongoose.disconnect();
}

resetToBlankStore().catch(err => {
  console.error('[Reset Error]', err);
  process.exit(1);
});
