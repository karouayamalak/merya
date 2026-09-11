import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../models/Product.js';
import { Category } from '../models/Category.js';

dotenv.config();

if (!process.env.MONGODB_URI) {
  console.error('[Import Error] FATAL: MONGODB_URI environment variable is required.');
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI;

const sourceFiles = [
  {
    src: 'C:/Users/ayaka/.gemini/antigravity-ide/brain/08c7c655-0794-4fc0-8ae5-f68d29bd1729/.user_uploaded/media_1788872666629.jpg',
    dest: 'merya_dress_blue_1.jpg'
  },
  {
    src: 'C:/Users/ayaka/.gemini/antigravity-ide/brain/08c7c655-0794-4fc0-8ae5-f68d29bd1729/.user_uploaded/media_1788872666636.jpg',
    dest: 'merya_dress_brown_1.jpg'
  },
  {
    src: 'C:/Users/ayaka/.gemini/antigravity-ide/brain/08c7c655-0794-4fc0-8ae5-f68d29bd1729/.user_uploaded/media_1788872666641.jpg',
    dest: 'merya_dress_pink_1.jpg'
  },
  {
    src: 'C:/Users/ayaka/.gemini/antigravity-ide/brain/08c7c655-0794-4fc0-8ae5-f68d29bd1729/.user_uploaded/media_1788872666650.jpg',
    dest: 'merya_dress_pink_2.jpg'
  },
  {
    src: 'C:/Users/ayaka/.gemini/antigravity-ide/brain/08c7c655-0794-4fc0-8ae5-f68d29bd1729/.user_uploaded/media_1788872666659.jpg',
    dest: 'merya_dress_brown_2.jpg'
  }
];

const backendUploads = path.resolve('uploads');
const frontendProducts = path.resolve('../frontend/public/products');

if (!fs.existsSync(backendUploads)) {
  fs.mkdirSync(backendUploads, { recursive: true });
}
if (!fs.existsSync(frontendProducts)) {
  fs.mkdirSync(frontendProducts, { recursive: true });
}

console.log('Copying images...');
for (const item of sourceFiles) {
  if (fs.existsSync(item.src)) {
    const destBackend = path.join(backendUploads, item.dest);
    const destFrontend = path.join(frontendProducts, item.dest);
    fs.copyFileSync(item.src, destBackend);
    fs.copyFileSync(item.src, destFrontend);
    console.log(`Copied ${item.dest}`);
  } else {
    console.warn(`Source not found: ${item.src}`);
  }
}

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  let category = await Category.findOne({ slug: 'flowing-dresses' });
  if (!category) {
    category = await Category.findOne();
  }

  const productData = {
    name: "L'Ensemble Soie & Broderie MERYA",
    slug: "l-ensemble-soie-broderie-merya",
    description: "Sublime ensemble haute modestie MERYA DZ confectionné avec un tissu soyeux de première qualité et un corsage délicatement brodé à manches bouffantes. Silhouette fluide, retombé noble et élégance intemporelle pour vos plus belles occasions et sorties quotidiennes.",
    category: category._id,
    sellingPrice: 8800,
    costPrice: 5200,
    isActive: true,
    isBestSeller: true,
    colors: [
      {
        colorName: 'Bleu Ciel Pastel',
        colorCode: '#A0C4E2',
        images: [
          '/uploads/merya_dress_blue_1.jpg'
        ],
        sizes: [
          { size: 'S', stock: 8 },
          { size: 'M', stock: 12 },
          { size: 'L', stock: 6 },
          { size: 'XL', stock: 4 }
        ]
      },
      {
        colorName: 'Rose Poudré',
        colorCode: '#E6B8C0',
        images: [
          '/uploads/merya_dress_pink_1.jpg',
          '/uploads/merya_dress_pink_2.jpg'
        ],
        sizes: [
          { size: 'S', stock: 7 },
          { size: 'M', stock: 15 },
          { size: 'L', stock: 8 },
          { size: 'XL', stock: 5 }
        ]
      },
      {
        colorName: 'Marron Chocolat',
        colorCode: '#4A2E1B',
        images: [
          '/uploads/merya_dress_brown_2.jpg',
          '/uploads/merya_dress_brown_1.jpg'
        ],
        sizes: [
          { size: 'S', stock: 6 },
          { size: 'M', stock: 10 },
          { size: 'L', stock: 6 },
          { size: 'XL', stock: 3 }
        ]
      }
    ]
  };

  const existing = await Product.findOne({ slug: productData.slug });
  if (existing) {
    await Product.updateOne({ slug: productData.slug }, productData);
    console.log('Updated existing product:', productData.name);
  } else {
    await Product.create(productData);
    console.log('Created new product:', productData.name);
  }

  await mongoose.disconnect();
  console.log('Done!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
