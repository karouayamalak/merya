import assert from 'assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product } from '../src/models/Product.js';
import { Category } from '../src/models/Category.js';
import { Banner } from '../src/models/Banner.js';
import { migrateMultilingualContent } from '../src/seed/migrateMultilingualContent.js';

dotenv.config();

const DB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0';

let passCount = 0;
function pass(msg) {
  console.log(`  ✓ ${msg}`);
  passCount++;
}

async function runTests() {
  console.log('=== RUNNING MULTILINGUAL CONTENT SYSTEM TEST SUITE ===\n');

  await mongoose.connect(DB_URI);
  console.log('[Setup] Connected to MongoDB');

  // Clean test fixtures
  await Category.deleteMany({ slug: { $regex: /^test-multi-/ } });
  await Product.deleteMany({ slug: { $regex: /^test-multi-/ } });
  await Banner.deleteMany({ link: { $regex: /test-multi/ } });

  // -------------------------------------------------------------
  // Test 1: Category with full multilingual names (FR, AR, EN)
  // -------------------------------------------------------------
  const cat = await Category.create({
    name: {
      fr: 'Robes de Soirée',
      ar: 'فساتين السهرة',
      en: 'Evening Dresses'
    },
    slug: 'test-multi-cat-1',
    description: {
      fr: 'Élégance intemporelle',
      ar: 'أناقة لا مثيل لها',
      en: 'Timeless elegance'
    },
    image: '/test-cat.jpg'
  });

  assert.strictEqual(cat.name.fr, 'Robes de Soirée');
  assert.strictEqual(cat.name.ar, 'فساتين السهرة');
  assert.strictEqual(cat.name.en, 'Evening Dresses');
  assert.deepStrictEqual(cat.translationStatus, { fr: true, ar: true, en: true });
  pass('1. Full multilingual category created with correct translationStatus { fr: true, ar: true, en: true }');

  // -------------------------------------------------------------
  // Test 2: Category with partial translation (FR only)
  // -------------------------------------------------------------
  const partialCat = await Category.create({
    name: {
      fr: 'Abayas Modernes',
      ar: '',
      en: ''
    },
    slug: 'test-multi-cat-partial',
    image: '/test-cat2.jpg'
  });
  assert.deepStrictEqual(partialCat.translationStatus, { fr: true, ar: false, en: false });
  pass('2. Partial translation category sets correct translationStatus { fr: true, ar: false, en: false }');

  // -------------------------------------------------------------
  // Test 3: Backward compatibility - string name automatically cast
  // -------------------------------------------------------------
  const legacyCat = await Category.create({
    name: 'Hijabs en Soie',
    slug: 'test-multi-cat-legacy',
    image: '/test-cat3.jpg'
  });
  assert.strictEqual(legacyCat.name.fr, 'Hijabs en Soie');
  assert.strictEqual(legacyCat.name.ar, '');
  assert.strictEqual(legacyCat.name.en, '');
  pass('3. Backward compatibility: raw string name automatically normalized to { fr: string, ar: "", en: "" }');

  // -------------------------------------------------------------
  // Test 4: Product with full multilingual names & descriptions
  // -------------------------------------------------------------
  const prod = await Product.create({
    name: {
      fr: 'Robe Merya Royale',
      ar: 'فستان ميريا الملكي',
      en: 'Royal Merya Dress'
    },
    slug: 'test-multi-prod-1',
    description: {
      fr: 'Robe en satin de soie avec finitions artisanales',
      ar: 'فستان حريري من الساتان بتفاصيل حرفية فاخرة',
      en: 'Silk satin dress with artisanal finishes'
    },
    category: cat._id,
    basePrice: 12000,
    sellingPrice: 12000,
    costPrice: 6000,
    colors: [
      {
        colorName: 'Bleu Nuit',
        colorCode: '#0A192F',
        images: ['/prod-blue.jpg'],
        sizes: [
          { size: 'M', stock: 10 }
        ]
      }
    ]
  });

  assert.strictEqual(prod.name.fr, 'Robe Merya Royale');
  assert.strictEqual(prod.name.ar, 'فستان ميريا الملكي');
  assert.strictEqual(prod.name.en, 'Royal Merya Dress');
  assert.deepStrictEqual(prod.translationStatus, { fr: true, ar: true, en: true });
  assert.strictEqual(prod.totalStock, 10);
  pass('4. Multilingual product created with translationStatus and totalStock virtuals');

  // -------------------------------------------------------------
  // Test 5: Multilingual Search matches across FR, AR, EN
  // -------------------------------------------------------------
  // Search Arabic keyword
  const arSearch = await Product.find({
    $or: [
      { 'name.fr': { $regex: 'فستان', $options: 'i' } },
      { 'name.ar': { $regex: 'فستان', $options: 'i' } },
      { 'name.en': { $regex: 'فستان', $options: 'i' } }
    ]
  });
  assert(arSearch.some(p => p._id.equals(prod._id)), 'Search with Arabic keyword should match product');

  // Search French keyword
  const frSearch = await Product.find({
    $or: [
      { 'name.fr': { $regex: 'Royale', $options: 'i' } },
      { 'name.ar': { $regex: 'Royale', $options: 'i' } },
      { 'name.en': { $regex: 'Royale', $options: 'i' } }
    ]
  });
  assert(frSearch.some(p => p._id.equals(prod._id)), 'Search with French keyword should match product');

  // Search English keyword
  const enSearch = await Product.find({
    $or: [
      { 'name.fr': { $regex: 'Dress', $options: 'i' } },
      { 'name.ar': { $regex: 'Dress', $options: 'i' } },
      { 'name.en': { $regex: 'Dress', $options: 'i' } }
    ]
  });
  assert(enSearch.some(p => p._id.equals(prod._id)), 'Search with English keyword should match product');
  pass('5. Cross-language search queries in FR, AR, EN all match the identical product ObjectId without duplication');

  // -------------------------------------------------------------
  // Test 6: Multilingual Banner creation & retrieval
  // -------------------------------------------------------------
  const banner = await Banner.create({
    title: {
      fr: 'Collection Hiver 2026',
      ar: 'تشكيلة شتاء 2026',
      en: 'Winter 2026 Collection'
    },
    subtitle: {
      fr: 'La modestie rencontre la haute couture',
      ar: 'الحشمة تلتقي بالفخامة العصرية',
      en: 'Modesty meets contemporary haute couture'
    },
    buttonText: {
      fr: 'Découvrir',
      ar: 'اكتشفي الآن',
      en: 'Discover Now'
    },
    image: '/winter-banner.jpg',
    link: '/test-multi/winter',
    placement: 'home_hero',
    isActive: true,
    displayOrder: 1
  });

  assert.strictEqual(banner.title.fr, 'Collection Hiver 2026');
  assert.strictEqual(banner.title.ar, 'تشكيلة شتاء 2026');
  assert.strictEqual(banner.buttonText.en, 'Discover Now');
  pass('6. Multilingual Banner created with title, subtitle, CTA text in FR, AR, EN');

  // -------------------------------------------------------------
  // Test 7: Migration test on raw MongoDB collection
  // -------------------------------------------------------------
  const rawDb = mongoose.connection.db;
  const legacyProdId = new mongoose.Types.ObjectId();
  await rawDb.collection('products').insertOne({
    _id: legacyProdId,
    name: 'Ancienne Robe Vintage',
    description: 'Une ancienne description en texte brut',
    slug: 'test-multi-raw-vintage',
    category: cat._id,
    basePrice: 5000,
    sellingPrice: 5000,
    costPrice: 2500,
    colors: [{ colorName: 'Noir', colorCode: '#000', images: ['/noir.jpg'], sizes: [{ size: 'L', stock: 5 }] }],
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const migrationStats = await migrateMultilingualContent();
  assert(migrationStats.migratedProducts >= 1, 'Migration must migrate at least 1 raw string product');

  const migratedDoc = await Product.findById(legacyProdId);
  assert.strictEqual(migratedDoc.name.fr, 'Ancienne Robe Vintage');
  assert.strictEqual(migratedDoc.name.ar, '');
  assert.strictEqual(migratedDoc.name.en, '');
  assert.strictEqual(migratedDoc.description.fr, 'Une ancienne description en texte brut');
  pass('7. Migration successfully transformed legacy unilingual documents into structured multilingual records');

  // -------------------------------------------------------------
  // Test 8: Validation rejects product without any name translation
  // -------------------------------------------------------------
  let failedValidation = false;
  try {
    await Product.create({
      name: { fr: '', ar: '', en: '' },
      slug: 'test-multi-empty-name',
      description: { fr: 'Valid desc', ar: '', en: '' },
      category: cat._id,
      basePrice: 4000,
      sellingPrice: 4000,
      costPrice: 2000,
      colors: []
    });
  } catch (err) {
    failedValidation = true;
  }
  assert.strictEqual(failedValidation, true, 'Product with completely empty translations must fail validation');
  pass('8. Validation strictly rejects product when no language provides a name');

  // Clean up fixtures
  await Category.deleteMany({ slug: { $regex: /^test-multi-/ } });
  await Product.deleteMany({ slug: { $regex: /^test-multi-/ } });
  await Banner.deleteMany({ link: { $regex: /test-multi/ } });

  console.log(`\n=== ALL ${passCount} MULTILINGUAL TESTS PASSED SUCCESSFULLY! ===`);
  await mongoose.disconnect();
}

runTests().catch(err => {
  console.error('\n❌ Multilingual test failed:', err);
  process.exit(1);
});
