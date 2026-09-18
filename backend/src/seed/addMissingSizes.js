/**
 * addMissingSizes.js — One-time migration
 *
 * For every active product in the DB, ensures each color variant has ALL
 * supported sizes in its sizes array.  Missing sizes are inserted with stock 0.
 * Sizes that already exist are left untouched (no stock reset).
 *
 * Run from the backend directory:
 *   node --env-file=.env src/seed/addMissingSizes.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../models/Product.js';

dotenv.config();

if (!process.env.MONGODB_URI) {
  console.error('[Migration] FATAL: MONGODB_URI environment variable is required.');
  process.exit(1);
}

const ALL_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Standard', 'One Size'];

async function migrate() {
  try {
    console.log('[Migration] Connecting to MongoDB…');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('[Migration] Connected.\n');

    const products = await Product.find({ isArchived: { $ne: true } });
    console.log(`[Migration] Found ${products.length} products to check.\n`);

    let totalUpdated = 0;
    let totalSizesAdded = 0;

    for (const product of products) {
      const displayName = (typeof product.name === 'object'
        ? (product.name.fr || product.name.en || product.name.ar || String(product._id))
        : (product.name || String(product._id)));

      let productModified = false;
      let sizesAddedForProduct = 0;

      for (const color of product.colors) {
        const existingSizeNames = new Set((color.sizes || []).map(s => s.size));
        const missingSizes = ALL_SIZES.filter(sz => !existingSizeNames.has(sz));

        if (missingSizes.length > 0) {
          for (const sz of missingSizes) {
            color.sizes.push({ size: sz, stock: 0 });
            sizesAddedForProduct++;
          }
          productModified = true;
          console.log(`  + ${displayName} / ${color.colorName}: adding ${missingSizes.join(', ')}`);
        }
      }

      if (productModified) {
        await product.save();
        totalUpdated++;
        totalSizesAdded += sizesAddedForProduct;
        console.log(`  ✓ Saved (${sizesAddedForProduct} new size rows)\n`);
      } else {
        console.log(`  · "${displayName}" — all sizes present, skipping`);
      }
    }

    console.log(`\n[Migration] Complete.`);
    console.log(`  Products updated : ${totalUpdated}`);
    console.log(`  Size rows added  : ${totalSizesAdded}`);
  } catch (err) {
    console.error('[Migration] Error:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('[Migration] Disconnected.');
  }
}

migrate();
