import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from './src/models/Product.js';

dotenv.config();

async function fixRobeAminaImage() {
  try {
    console.log('[Fix] Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('[Fix] Connected successfully.');

    // Find the problematic product
    const product = await Product.findOne({ slug: 'robe-amina' });
    
    if (!product) {
      console.log('[Fix] Product "robe-amina" not found. Nothing to fix.');
      process.exit(0);
    }

    console.log('[Fix] Found product:', product.slug);
    console.log('[Fix] Current colors:');
    product.colors.forEach((c, i) => {
      console.log(`  Color ${i}: ${c.colorName}`);
      c.images.forEach((img, j) => console.log(`    Image ${j}: ${img}`));
    });

    // Fix the image path - this UUID should either be a Cloudinary URL
    // or if it's a local file, it should be in /products/
    let hasUploadsPath = false;
    for (const color of product.colors) {
      for (let i = 0; i < color.images.length; i++) {
        if (color.images[i].startsWith('/uploads/')) {
          hasUploadsPath = true;
          // This is a UUID filename - it should be served via Cloudinary
          // or moved to /products/ if it's a static asset
          // For now, we'll replace with a placeholder Cloudinary URL pattern
          // In production, this should be uploaded to Cloudinary
          console.log(`[Fix] Replacing /uploads/ path: ${color.images[i]}`);
          // Use a valid frontend static asset as placeholder
          color.images[i] = '/products/merya_dress_blue_1.jpg';
        }
      }
    }

    if (hasUploadsPath) {
      await product.save();
      console.log('[Fix] Product updated successfully.');
    } else {
      console.log('[Fix] No /uploads/ paths found. Product is already clean.');
    }

    // Verify
    const updated = await Product.findOne({ slug: 'robe-amina' });
    console.log('[Fix] Verification:');
    updated.colors.forEach((c, i) => {
      c.images.forEach((img, j) => console.log(`  Image ${i}.${j}: ${img}`));
    });

    await mongoose.disconnect();
    console.log('[Fix] Done.');
    process.exit(0);
  } catch (error) {
    console.error('[Fix Error]:', error);
    process.exit(1);
  }
}

fixRobeAminaImage();