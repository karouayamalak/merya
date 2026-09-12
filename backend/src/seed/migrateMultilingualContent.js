import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { connectDB } from '../config/db.js';

dotenv.config();

export async function migrateMultilingualContent() {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection not established.');
  }

  console.log('[Migration: Multilingual] Starting safe migration of products and categories...');

  // 1. Products Migration
  const productsCollection = db.collection('products');
  const allProducts = await productsCollection.find({}).toArray();
  let migratedProducts = 0;

  for (const prod of allProducts) {
    let needsUpdate = false;
    const updateFields = {};

    // Check name
    if (typeof prod.name === 'string') {
      updateFields.name = {
        fr: prod.name.trim(),
        ar: '',
        en: ''
      };
      needsUpdate = true;
    } else if (prod.name && typeof prod.name === 'object') {
      // Ensure all 3 language keys exist
      updateFields.name = {
        fr: typeof prod.name.fr === 'string' ? prod.name.fr : '',
        ar: typeof prod.name.ar === 'string' ? prod.name.ar : '',
        en: typeof prod.name.en === 'string' ? prod.name.en : ''
      };
      if (prod.name.fr !== updateFields.name.fr || prod.name.ar !== updateFields.name.ar || prod.name.en !== updateFields.name.en) {
        needsUpdate = true;
      }
    }

    // Check description
    if (typeof prod.description === 'string') {
      updateFields.description = {
        fr: prod.description.trim(),
        ar: '',
        en: ''
      };
      needsUpdate = true;
    } else if (prod.description && typeof prod.description === 'object') {
      updateFields.description = {
        fr: typeof prod.description.fr === 'string' ? prod.description.fr : '',
        ar: typeof prod.description.ar === 'string' ? prod.description.ar : '',
        en: typeof prod.description.en === 'string' ? prod.description.en : ''
      };
      if (prod.description.fr !== updateFields.description.fr || prod.description.ar !== updateFields.description.ar || prod.description.en !== updateFields.description.en) {
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      await productsCollection.updateOne(
        { _id: prod._id },
        { $set: updateFields }
      );
      migratedProducts++;
    }
  }

  // 2. Categories Migration
  const categoriesCollection = db.collection('categories');
  const allCategories = await categoriesCollection.find({}).toArray();
  let migratedCategories = 0;

  for (const cat of allCategories) {
    let needsUpdate = false;
    const updateFields = {};

    // Check name
    if (typeof cat.name === 'string') {
      updateFields.name = {
        fr: cat.name.trim(),
        ar: '',
        en: ''
      };
      needsUpdate = true;
    } else if (cat.name && typeof cat.name === 'object') {
      updateFields.name = {
        fr: typeof cat.name.fr === 'string' ? cat.name.fr : '',
        ar: typeof cat.name.ar === 'string' ? cat.name.ar : '',
        en: typeof cat.name.en === 'string' ? cat.name.en : ''
      };
      if (cat.name.fr !== updateFields.name.fr || cat.name.ar !== updateFields.name.ar || cat.name.en !== updateFields.name.en) {
        needsUpdate = true;
      }
    }

    // Check description
    if (typeof cat.description === 'string') {
      updateFields.description = {
        fr: cat.description.trim(),
        ar: '',
        en: ''
      };
      needsUpdate = true;
    } else if (cat.description && typeof cat.description === 'object') {
      updateFields.description = {
        fr: typeof cat.description.fr === 'string' ? cat.description.fr : '',
        ar: typeof cat.description.ar === 'string' ? cat.description.ar : '',
        en: typeof cat.description.en === 'string' ? cat.description.en : ''
      };
      if (cat.description.fr !== updateFields.description.fr || cat.description.ar !== updateFields.description.ar || cat.description.en !== updateFields.description.en) {
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      await categoriesCollection.updateOne(
        { _id: cat._id },
        { $set: updateFields }
      );
      migratedCategories++;
    }
  }

  console.log(`[Migration: Multilingual] Completed successfully! Migrated ${migratedProducts} products and ${migratedCategories} categories.`);
  return { migratedProducts, migratedCategories };
}

// Allow running directly via node CLI
if (process.argv[1] && process.argv[1].endsWith('migrateMultilingualContent.js')) {
  (async () => {
    try {
      await connectDB();
      await migrateMultilingualContent();
      process.exit(0);
    } catch (err) {
      console.error('[Migration Error]:', err);
      process.exit(1);
    }
  })();
}
