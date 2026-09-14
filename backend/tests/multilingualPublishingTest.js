import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product, isProductFullyTranslated } from '../src/models/Product.js';
import { Category, isCategoryFullyTranslated } from '../src/models/Category.js';
import { Banner, isBannerFullyTranslated } from '../src/models/Banner.js';
import { createProduct, updateProduct } from '../src/controllers/productController.js';
import { createCategory, updateCategory } from '../src/controllers/categoryController.js';
import { createBanner, updateBanner } from '../src/controllers/bannerController.js';

dotenv.config();
const DB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0&directConnection=true';

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

let passCount = 0;
function pass(msg) {
  console.log(`  ✓ ${msg}`);
  passCount++;
}

async function run() {
  console.log('=== RUNNING MULTILINGUAL PUBLISHING TEST SUITE ===');

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(DB_URI);
  }

  // -------------------------------------------------------------
  // Test 1: Category Publishing Validation
  // -------------------------------------------------------------
  const catDraftRes = mockRes();
  await createCategory({
    body: {
      name: { fr: 'Abayas Luxe', ar: '', en: '' },
      image: 'https://example.com/cat.jpg',
      isActive: false
    }
  }, catDraftRes, () => {});
  assert.strictEqual(catDraftRes.statusCode, 201, 'Draft category with incomplete translations should succeed');
  assert.strictEqual(catDraftRes.body.category.isActive, false, 'Category must be saved as draft');
  const draftCatId = catDraftRes.body.category._id;
  pass('1. Incomplete category allowed to save as draft (isActive: false)');

  const catPublishFailRes = mockRes();
  await createCategory({
    body: {
      name: { fr: 'Robes Soirée', ar: '', en: '' },
      image: 'https://example.com/cat2.jpg',
      isActive: true
    }
  }, catPublishFailRes, () => {});
  assert.strictEqual(catPublishFailRes.statusCode, 400, 'Publishing incomplete category must fail with 400');
  assert.strictEqual(catPublishFailRes.body.code, 'TRANSLATIONS_INCOMPLETE');
  pass('2. Publishing incomplete category strictly rejected with TRANSLATIONS_INCOMPLETE');

  const catUpdateFailRes = mockRes();
  await updateCategory({
    params: { id: draftCatId },
    body: { isActive: true }
  }, catUpdateFailRes, () => {});
  assert.strictEqual(catUpdateFailRes.statusCode, 400, 'Updating draft category to active without translations must fail');
  assert.strictEqual(catUpdateFailRes.body.code, 'TRANSLATIONS_INCOMPLETE');
  pass('3. Updating draft category to published strictly blocked until translations are complete');

  const catNoDescFailRes = mockRes();
  await createCategory({
    body: {
      name: { fr: 'Robes Modernes', ar: 'فساتين عصرية', en: 'Modern Dresses' },
      description: { fr: 'Seulement en français', ar: '', en: '' },
      image: 'https://example.com/cat3.jpg',
      isActive: true
    }
  }, catNoDescFailRes, () => {});
  assert.strictEqual(catNoDescFailRes.statusCode, 400, 'Publishing category with incomplete description translations must fail');
  assert.strictEqual(catNoDescFailRes.body.code, 'TRANSLATIONS_INCOMPLETE');
  pass('3b. Category with incomplete description translations strictly blocked from publishing');

  const catCompleteRes = mockRes();
  await createCategory({
    body: {
      name: { fr: 'Robes Modernes', ar: 'فساتين عصرية', en: 'Modern Dresses' },
      description: { fr: 'Robes modernes et élégantes', ar: 'فساتين عصرية وأنيقة', en: 'Modern and elegant dresses' },
      image: 'https://example.com/cat3.jpg',
      isActive: true
    }
  }, catCompleteRes, () => {});
  assert.strictEqual(catCompleteRes.statusCode, 201, 'Complete category published successfully');
  assert.strictEqual(catCompleteRes.body.category.isActive, true);
  const completeCatId = catCompleteRes.body.category._id;
  pass('4. Fully translated category (name & description in FR/AR/EN) successfully published');

  // -------------------------------------------------------------
  // Test 2: Product Publishing Validation
  // -------------------------------------------------------------
  const prodDraftRes = mockRes();
  await createProduct({
    body: {
      name: { fr: 'Robe Soie Incomplète', ar: '', en: '' },
      description: { fr: 'Description produit', ar: '', en: '' },
      category: completeCatId,
      sellingPrice: 5000,
      costPrice: 2500,
      isActive: false,
      colors: [{ colorName: 'Noir', colorCode: '#000', images: ['/img.jpg'], sizes: [{ size: 'M' }] }]
    }
  }, prodDraftRes, (err) => { if (err) throw err; });
  assert.strictEqual(prodDraftRes.statusCode, 201, 'Draft product with incomplete translations should succeed');
  assert.strictEqual(prodDraftRes.body.product.isActive, false);
  const draftProdId = prodDraftRes.body.product._id;
  pass('5. Incomplete product allowed to save as draft (isActive: false)');

  const prodPublishFailRes = mockRes();
  await createProduct({
    body: {
      name: { fr: 'Robe Royale', ar: '', en: '' },
      description: { fr: 'Description produit', ar: '', en: '' },
      category: completeCatId,
      sellingPrice: 6000,
      costPrice: 3000,
      isActive: true,
      colors: [{ colorName: 'Noir', colorCode: '#000', images: ['/img.jpg'], sizes: [{ size: 'M' }] }]
    }
  }, prodPublishFailRes, (err) => { if (err) throw err; });
  assert.strictEqual(prodPublishFailRes.statusCode, 400);
  assert.strictEqual(prodPublishFailRes.body.code, 'TRANSLATIONS_INCOMPLETE');
  pass('6. Publishing incomplete product strictly rejected with TRANSLATIONS_INCOMPLETE');

  const prodUpdateFailRes = mockRes();
  await updateProduct({
    params: { id: draftProdId },
    body: { isActive: true }
  }, prodUpdateFailRes, (err) => { if (err) throw err; });
  assert.strictEqual(prodUpdateFailRes.statusCode, 400);
  assert.strictEqual(prodUpdateFailRes.body.code, 'TRANSLATIONS_INCOMPLETE');
  pass('7. Updating draft product to published strictly blocked until translations are complete');

  const prodCompleteRes = mockRes();
  await createProduct({
    body: {
      name: { fr: 'Robe Soie Complète', ar: 'فستان حرير كامل', en: 'Complete Silk Dress' },
      description: { fr: 'Robe en soie', ar: 'فستان من الحرير', en: 'Silk dress' },
      category: completeCatId,
      sellingPrice: 7000,
      costPrice: 3500,
      isActive: true,
      colors: [{ colorName: 'Noir', colorCode: '#000', images: ['/img.jpg'], sizes: [{ size: 'M' }] }]
    }
  }, prodCompleteRes, (err) => { if (err) throw err; });
  assert.strictEqual(prodCompleteRes.statusCode, 201);
  assert.strictEqual(prodCompleteRes.body.product.isActive, true);
  pass('8. Fully translated product (name + description) successfully published (isActive: true)');

  // Verify description-only incomplete product is blocked from publishing
  const prodDescIncompleteRes = mockRes();
  await createProduct({
    body: {
      name: { fr: 'Robe Desc Test', ar: 'فستان اختبار', en: 'Desc Test Dress' },
      description: { fr: 'Desc French only', ar: '', en: '' },
      category: completeCatId,
      sellingPrice: 5500,
      costPrice: 2800,
      isActive: true,
      colors: [{ colorName: 'Blanc', colorCode: '#FFF', images: ['/img2.jpg'], sizes: [{ size: 'S' }] }]
    }
  }, prodDescIncompleteRes, (err) => { if (err) throw err; });
  assert.strictEqual(prodDescIncompleteRes.statusCode, 400);
  assert.strictEqual(prodDescIncompleteRes.body.code, 'TRANSLATIONS_INCOMPLETE');
  pass('9. Product with complete name but incomplete description cannot be published');

  // -------------------------------------------------------------
  // Test 3: Banner Publishing Validation
  // -------------------------------------------------------------
  const bannerDraftRes = mockRes();
  await createBanner({
    body: {
      title: { fr: 'Soldes Hiver', ar: '', en: '' },
      image: '/banner-draft.jpg',
      placement: 'hero',
      isActive: false
    }
  }, bannerDraftRes, () => {});
  assert.strictEqual(bannerDraftRes.statusCode, 201);
  assert.strictEqual(bannerDraftRes.body.banner.isActive, false);
  const draftBannerId = bannerDraftRes.body.banner._id;
  pass('10. Incomplete banner allowed to save as draft (isActive: false)');

  const bannerPublishFailRes = mockRes();
  await createBanner({
    body: {
      title: { fr: 'Soldes Hiver', ar: '', en: '' },
      image: '/banner.jpg',
      placement: 'hero',
      isActive: true
    }
  }, bannerPublishFailRes, () => {});
  assert.strictEqual(bannerPublishFailRes.statusCode, 400);
  assert.strictEqual(bannerPublishFailRes.body.code, 'TRANSLATIONS_INCOMPLETE');
  pass('11. Publishing incomplete banner strictly rejected with TRANSLATIONS_INCOMPLETE');

  const bannerCompleteRes = mockRes();
  await createBanner({
    body: {
      title: { fr: 'Offre Spéciale', ar: 'عرض خاص', en: 'Special Offer' },
      image: '/banner-complete.jpg',
      placement: 'hero',
      isActive: true
    }
  }, bannerCompleteRes, () => {});
  assert.strictEqual(bannerCompleteRes.statusCode, 201);
  assert.strictEqual(bannerCompleteRes.body.banner.isActive, true);
  pass('12. Fully translated banner successfully published (isActive: true)');

  // Clean up
  await Category.deleteMany({ _id: { $in: [draftCatId, completeCatId] } });
  await Product.deleteMany({ _id: { $in: [draftProdId, prodCompleteRes.body.product._id] } });
  await Banner.deleteMany({ _id: { $in: [draftBannerId, bannerCompleteRes.body.banner._id] } });

  console.log(`\n=== ALL ${passCount} MULTILINGUAL PUBLISHING TESTS PASSED! ===`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
