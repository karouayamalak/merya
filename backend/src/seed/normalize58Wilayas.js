import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { DeliverySetting } from '../models/DeliverySetting.js';
import { ALGERIA_WILAYAS } from '../config/constants.js';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0';

function getDefaultWilayaRates(code) {
  if (code === 16) return { homeFee: 500, agencyFee: 350 };
  if ([9, 35, 42].includes(code)) return { homeFee: 600, agencyFee: 400 };
  if ([31, 25, 19, 15, 6, 23, 13, 27, 2, 5, 18, 21, 22, 24, 26, 29, 34, 43, 44, 46, 48].includes(code)) return { homeFee: 750, agencyFee: 450 };
  if ([3, 4, 7, 10, 12, 14, 17, 20, 28, 38, 40, 41, 45, 51].includes(code)) return { homeFee: 850, agencyFee: 500 };
  if ([8, 30, 32, 39, 47, 55, 57, 58].includes(code)) return { homeFee: 1000, agencyFee: 700 };
  return { homeFee: 1400, agencyFee: 900 };
}

/**
 * Safe, idempotent migration to normalize active delivery settings to the canonical 58 Wilaya system.
 * CRITICAL SAFETY INVARIANT:
 * This migration modifies ONLY the singleton DeliverySetting document.
 * It NEVER modifies, deletes, or rewrites historical orders.
 */
export async function normalize58Wilayas() {
  console.log('[Migration] Normalizing active DeliverySetting to canonical 58 Algerian Wilayas...');

  let deliverySetting = await DeliverySetting.findOne();
  if (!deliverySetting) {
    console.log('[Migration] No DeliverySetting found. Creating fresh 58-wilaya dataset...');
    deliverySetting = new DeliverySetting({
      agencyDeliveryFee: 500,
      homeDeliveryFee: 800,
      freeDeliveryThreshold: 0,
      wilayaRates: []
    });
  }

  // Filter and merge rates for codes 1..58 only
  const existingMap = new Map((deliverySetting.wilayaRates || []).map(r => [r.wilayaCode, r]));

  const normalizedRates = ALGERIA_WILAYAS.map(canonical => {
    if (existingMap.has(canonical.code)) {
      const existing = existingMap.get(canonical.code);
      return {
        wilayaCode: canonical.code,
        wilayaName: canonical.name,
        wilayaNameAr: canonical.nameAr,
        homeFee: existing.homeFee,
        agencyFee: existing.agencyFee,
        isAvailable: existing.isAvailable !== false
      };
    } else {
      const def = getDefaultWilayaRates(canonical.code);
      return {
        wilayaCode: canonical.code,
        wilayaName: canonical.name,
        wilayaNameAr: canonical.nameAr,
        homeFee: def.homeFee,
        agencyFee: def.agencyFee,
        isAvailable: true
      };
    }
  }).sort((a, b) => a.wilayaCode - b.wilayaCode);

  deliverySetting.wilayaRates = normalizedRates;
  await deliverySetting.save();

  console.log(`[Migration] Success! DeliverySetting now contains exactly ${deliverySetting.wilayaRates.length} Wilayas (codes 1-58). Historical orders untouched.`);
  return deliverySetting;
}

// Standalone execution support
if (process.argv[1]?.endsWith('normalize58Wilayas.js')) {
  (async () => {
    try {
      await mongoose.connect(MONGODB_URI);
      await normalize58Wilayas();
      await mongoose.disconnect();
      process.exit(0);
    } catch (err) {
      console.error('[Migration Error]', err);
      process.exit(1);
    }
  })();
}
