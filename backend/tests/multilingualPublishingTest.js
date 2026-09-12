import assert from 'node:assert';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Product, isProductFullyTranslated } from '../src/models/Product.js';
import { Category, isCategoryFullyTranslated } from '../src/models/Category.js';
import { Game, isGameFullyTranslated } from '../src/models/Game.js';
import { Banner, isBannerFullyTranslated } from '../src/models/Banner.js';
import { createProduct, updateProduct } from '../src/controllers/productController.js';
import { createCategory, updateCategory } from '../src/controllers/categoryController.js';
import { createBanner, updateBanner } from '../src/controllers/bannerController.js';
import { createGame, updateGame, getGames } from '../src/controllers/gameController.js';

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
  console.log('=== RUNNING MULTILINGUAL PUBLISHING & GAMES CONSISTENCY TEST SUITE ===');

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

  const catCompleteRes = mockRes();
  await createCategory({
    body: {
      name: { fr: 'Robes Modernes', ar: 'فساتين عصرية', en: 'Modern Dresses' },
      image: 'https://example.com/cat3.jpg',
      isActive: true
    }
  }, catCompleteRes, () => {});
  assert.strictEqual(catCompleteRes.statusCode, 201, 'Complete category published successfully');
  assert.strictEqual(catCompleteRes.body.category.isActive, true);
  const completeCatId = catCompleteRes.body.category._id;
  pass('4. Fully translated category successfully published (isActive: true)');

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
  pass('8. Fully translated product successfully published (isActive: true)');

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
  pass('9. Incomplete banner allowed to save as draft (isActive: false)');

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
  pass('10. Publishing incomplete banner strictly rejected with TRANSLATIONS_INCOMPLETE');

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
  pass('11. Fully translated banner successfully published (isActive: true)');

  // -------------------------------------------------------------
  // Test 4: Game Publishing Validation & Schema Consistency
  // -------------------------------------------------------------
  const gameDraftRes = mockRes();
  await createGame({
    body: {
      title: { fr: 'Quiz Style', ar: '', en: '' },
      type: 'quiz',
      coverImage: '/game-cover.jpg',
      reward: { discountCode: 'QUIZ10', discountPercent: 10 },
      isActive: false
    }
  }, gameDraftRes, () => {});
  assert.strictEqual(gameDraftRes.statusCode, 201);
  assert.strictEqual(gameDraftRes.body.game.isActive, false);
  const draftGameId = gameDraftRes.body.game._id;
  pass('12. Incomplete game allowed to save as draft (isActive: false)');

  const gamePublishFailRes = mockRes();
  await createGame({
    body: {
      title: { fr: 'Quiz Style', ar: '', en: '' },
      type: 'quiz',
      coverImage: '/game-cover.jpg',
      reward: { discountCode: 'QUIZ10', discountPercent: 10 },
      isActive: true
    }
  }, gamePublishFailRes, () => {});
  assert.strictEqual(gamePublishFailRes.statusCode, 400);
  assert.strictEqual(gamePublishFailRes.body.code, 'TRANSLATIONS_INCOMPLETE');
  pass('13. Publishing incomplete game strictly rejected with TRANSLATIONS_INCOMPLETE');

  const gameCompleteRes = mockRes();
  await createGame({
    body: {
      title: { fr: 'Roue Privilège', ar: 'عجلة التميز', en: 'VIP Wheel' },
      type: 'wheel',
      coverImage: '/wheel-cover.jpg',
      rules: { fr: 'Un tour par jour', ar: 'دورة واحدة يوميا', en: 'One spin per day' },
      instructions: { fr: 'Tournez la roue', ar: 'أديري العجلة', en: 'Spin the wheel' },
      winnerMessage: { fr: 'Gagné !', ar: 'مبروك !', en: 'You won!' },
      reward: { discountCode: 'VIPWHEEL', discountPercent: 15 },
      isActive: true
    }
  }, gameCompleteRes, () => {});
  assert.strictEqual(gameCompleteRes.statusCode, 201);
  assert.strictEqual(gameCompleteRes.body.game.isActive, true);
  assert.strictEqual(gameCompleteRes.body.game.type, 'wheel');
  assert.strictEqual(gameCompleteRes.body.game.gameType, 'wheel', 'type and gameType are synchronized');
  assert.strictEqual(gameCompleteRes.body.game.reward.discountCode, 'VIPWHEEL');
  pass('14. Fully translated game successfully published with synchronized type/gameType, rules, instructions, winnerMessage, reward');

  // -------------------------------------------------------------
  // Test 5: Public Games Endpoint filters drafts and incomplete games
  // -------------------------------------------------------------
  const publicGamesRes = mockRes();
  await getGames({}, publicGamesRes, () => {});
  assert.strictEqual(publicGamesRes.statusCode, 200);
  const returnedGames = publicGamesRes.body.games;
  assert(Array.isArray(returnedGames), 'Public games must be an array');
  assert(returnedGames.every(g => g.isActive === true), 'All public games must be active');
  assert(returnedGames.every(g => isGameFullyTranslated(g)), 'All public games must have complete FR, AR, and EN translations');
  assert(returnedGames.some(g => g.slug === gameCompleteRes.body.game.slug), 'Fully translated active game is visible');
  assert(!returnedGames.some(g => g.slug === gameDraftRes.body.game.slug), 'Draft incomplete game is NOT visible to customers');
  pass('15. Public GET /games returns only active, fully translated games; incomplete drafts are hidden');

  // Clean up
  await Category.deleteMany({ _id: { $in: [draftCatId, completeCatId] } });
  await Product.deleteMany({ _id: { $in: [draftProdId, prodCompleteRes.body.product._id] } });
  await Banner.deleteMany({ _id: { $in: [draftBannerId, bannerCompleteRes.body.banner._id] } });
  await Game.deleteMany({ _id: { $in: [draftGameId, gameCompleteRes.body.game._id] } });

  console.log(`\n=== ALL ${passCount} PUBLISHING & GAMES CONSISTENCY TESTS PASSED! ===`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
