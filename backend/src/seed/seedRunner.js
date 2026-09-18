// seedRunner.js — Callable seed function for the temporary /internal/seed-now endpoint
// ⚠️ TEMPORARY FILE — DELETE AFTER SEEDING IS COMPLETE

import bcrypt from 'bcryptjs';
import { Admin } from '../models/Admin.js';
import { Category } from '../models/Category.js';
import { Product } from '../models/Product.js';
import { Banner } from '../models/Banner.js';
import { DeliverySetting } from '../models/DeliverySetting.js';
import { ROLES, ALGERIA_WILAYAS } from '../config/constants.js';

function getDefaultWilayaRates(code) {
  if (code === 16) return { homeFee: 500, agencyFee: 350 };
  if ([9, 35, 42].includes(code)) return { homeFee: 600, agencyFee: 400 };
  if ([31, 25, 19, 15, 6, 23, 13, 27, 2, 5, 18, 21, 22, 24, 26, 29, 34, 43, 44, 46, 48].includes(code)) return { homeFee: 750, agencyFee: 450 };
  if ([3, 4, 7, 10, 12, 14, 17, 20, 28, 38, 40, 41, 45, 51].includes(code)) return { homeFee: 850, agencyFee: 500 };
  if ([8, 30, 32, 39, 47, 55, 57, 58].includes(code)) return { homeFee: 1000, agencyFee: 700 };
  return { homeFee: 1400, agencyFee: 900 };
}

export async function runSeedOnServer() {
  const log = [];

  // 1. Delivery Settings
  let deliverySetting = await DeliverySetting.findOne();
  const wilayaRates = ALGERIA_WILAYAS.map(w => {
    const d = getDefaultWilayaRates(w.code);
    return { wilayaCode: w.code, wilayaName: w.name, wilayaNameAr: w.nameAr, homeFee: d.homeFee, agencyFee: d.agencyFee, isAvailable: true };
  });

  if (!deliverySetting) {
    await DeliverySetting.create({ singletonKey: 'default', freeDeliveryThreshold: 0, wilayaRates });
    log.push('Delivery settings created with 58 Wilayas.');
  } else {
    const existingMap = new Map((deliverySetting.wilayaRates || []).map(r => [r.wilayaCode, r]));
    deliverySetting.wilayaRates = ALGERIA_WILAYAS.map(w => {
      if (existingMap.has(w.code)) {
        const ex = existingMap.get(w.code);
        return { wilayaCode: w.code, wilayaName: w.name, wilayaNameAr: w.nameAr, homeFee: ex.homeFee, agencyFee: ex.agencyFee, isAvailable: ex.isAvailable !== false };
      }
      const d = getDefaultWilayaRates(w.code);
      return { wilayaCode: w.code, wilayaName: w.name, wilayaNameAr: w.nameAr, homeFee: d.homeFee, agencyFee: d.agencyFee, isAvailable: true };
    }).sort((a, b) => a.wilayaCode - b.wilayaCode);
    await deliverySetting.save();
    log.push('Delivery settings normalized to 58 Wilayas.');
  }

  // 2. Admin User
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL;
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const existingAdmin = await Admin.findOne({ email: adminEmail.toLowerCase() });
    if (!existingAdmin) {
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      await Admin.create({ username: process.env.INITIAL_ADMIN_USERNAME || 'Store Owner', email: adminEmail.toLowerCase(), passwordHash, role: ROLES.OWNER, isActive: true });
      log.push(`Admin created: ${adminEmail}`);
    } else {
      log.push(`Admin already exists: ${adminEmail}`);
    }
  }

  // 3. Categories
  const categoryCount = await Category.countDocuments();
  let categories = [];
  if (categoryCount === 0) {
    categories = await Category.insertMany([
      { name: { fr: 'Abayas de Luxe', ar: 'عبايات فاخرة', en: 'Luxury Abayas' }, slug: 'luxury-abayas', description: { fr: 'Abayas haut de gamme confectionnées en soie de Médine.', ar: 'عبايات فاخرة من حرير المدينة.', en: 'Premium Nidha and Medina silk abayas.' }, image: '/products/merya_dress_blue_1.jpg', displayOrder: 1, isActive: true },
      { name: { fr: 'Khimars & Hijabs', ar: 'خمارات وحجابات', en: 'Khimars & Hijabs' }, slug: 'khimars-and-hijabs', description: { fr: 'Foulards respirants en soie de Médine.', ar: 'أوشحة من حرير المدينة.', en: 'Breathable Medina silk scarves.' }, image: '/products/merya_dress_pink_1.jpg', displayOrder: 2, isActive: true },
      { name: { fr: 'Ensembles Mastour', ar: 'أطقم محتشمة', en: 'Modest Co-ord Sets' }, slug: 'modest-co-ord-sets', description: { fr: 'Ensembles deux pièces élégants.', ar: 'أطقم نسائية محتشمة.', en: 'Contemporary two-piece sets.' }, image: '/products/merya_dress_brown_1.jpg', displayOrder: 3, isActive: true },
      { name: { fr: 'Robes Évasées', ar: 'فساتين انسيابية', en: 'Flowing Dresses' }, slug: 'flowing-dresses', description: { fr: 'Robes longues fluides.', ar: 'فساتين محتشمة.', en: 'Full-coverage lightweight dresses.' }, image: '/products/merya_dress_pink_2.jpg', displayOrder: 4, isActive: true },
      { name: { fr: 'Kimonos & Capes', ar: 'كيمونو وكاب', en: 'Kimonos & Capes' }, slug: 'kimonos-and-capes', description: { fr: 'Kaftans et kimonos élégants.', ar: 'عباءات كيمونو فاخرة.', en: 'Graceful outer layers and kaftans.' }, image: '/products/merya_dress_brown_2.jpg', displayOrder: 5, isActive: true }
    ]);
    log.push(`${categories.length} categories seeded.`);
  } else {
    categories = await Category.find();
    log.push(`Categories already exist (${categoryCount}), skipping.`);
  }

  // 4. Products
  const productCount = await Product.countDocuments();
  if (productCount === 0 && categories.length > 0) {
    const abayaCat = categories.find(c => c.slug === 'luxury-abayas') || categories[0];
    const khimarCat = categories.find(c => c.slug === 'khimars-and-hijabs') || categories[1];
    const setsCat = categories.find(c => c.slug === 'modest-co-ord-sets') || categories[2];
    const dressCat = categories.find(c => c.slug === 'flowing-dresses') || categories[3];
    const kimonoCat = categories.find(c => c.slug === 'kimonos-and-capes') || categories[4];

    await Product.insertMany([
      {
        name: { fr: 'Abaya en Soie de Médine Noor', ar: 'عباية نور من حرير المدينة', en: 'The Noor Medina Silk Abaya' },
        slug: 'the-noor-medina-silk-abaya',
        description: { fr: 'Silhouette emblématique en soie de Médine authentique avec manches raglan et ceinture ton sur ton.', ar: 'تصميم أيقوني من حرير المدينة مع أكمام انسيابية وأزرار مخفية.', en: 'Iconic silhouette in authentic Medina silk with raglan sleeves and concealed snap buttons.' },
        category: abayaCat._id, sellingPrice: 7500, costPrice: 4800, isActive: true, isBestSeller: true,
        colors: [
          { colorName: 'Warm Taupe', colorDisplayName: { fr: 'Taupe Chaud', ar: 'رمادي داكن دافئ', en: 'Warm Taupe' }, colorCode: '#B89C82', images: ['/products/merya_dress_blue_1.jpg', '/products/merya_dress_brown_1.jpg'], sizes: [{ size: 'S', stock: 8 }, { size: 'M', stock: 12 }, { size: 'L', stock: 6 }, { size: 'XL', stock: 4 }] },
          { colorName: 'Midnight Noir', colorDisplayName: { fr: 'Noir Minuit', ar: 'أسود داكن', en: 'Midnight Noir' }, colorCode: '#1F1E24', images: ['/products/merya_dress_brown_2.jpg'], sizes: [{ size: 'S', stock: 10 }, { size: 'M', stock: 15 }, { size: 'L', stock: 8 }, { size: 'XL', stock: 3 }] }
        ]
      },
      {
        name: { fr: 'Ensemble 2 Pièces en Lin Layla', ar: 'طقم ليلى قطعتين من الكتان', en: 'Layla 2-Piece Linen Co-Ord' },
        slug: 'layla-2-piece-linen-co-ord',
        description: { fr: 'Tunique longue assortie d\'un pantalon large en mélange de lin lavé.', ar: 'سترة طويلة مع بنطال واسع من مزيج الكتان.', en: 'Relaxed longline tunic with wide-leg trousers in premium washed linen blend.' },
        category: setsCat._id, sellingPrice: 8900, costPrice: 5400, isActive: true, isBestSeller: true,
        colors: [
          { colorName: 'Sand Beige', colorDisplayName: { fr: 'Beige Sable', ar: 'بيج رملي', en: 'Sand Beige' }, colorCode: '#D8C7B5', images: ['/products/merya_dress_brown_1.jpg'], sizes: [{ size: 'S', stock: 6 }, { size: 'M', stock: 9 }, { size: 'L', stock: 5 }, { size: 'XL', stock: 2 }] },
          { colorName: 'Deep Mocha', colorDisplayName: { fr: 'Moka Profond', ar: 'موكا عميق', en: 'Deep Mocha' }, colorCode: '#4A3B32', images: ['/products/merya_dress_brown_2.jpg'], sizes: [{ size: 'S', stock: 4 }, { size: 'M', stock: 8 }, { size: 'L', stock: 3 }, { size: 'XL', stock: 1 }] }
        ]
      },
      {
        name: { fr: 'Khimar Pointu Triangle Amina', ar: 'خمار أمينة المثلث', en: 'Amina Triangle French Khimar' },
        slug: 'amina-triangle-french-khimar',
        description: { fr: 'Khimar double couche en Wool Peach avec attaches intégrées.', ar: 'خمار مثلث من قماش الخوخ الفاخر مع أربطة مريحة.', en: 'Double-layer pointed khimar in ultra-breathable Wool Peach fabric.' },
        category: khimarCat._id, sellingPrice: 3200, costPrice: 1600, isActive: true, isBestSeller: true,
        colors: [
          { colorName: 'Champagne Taupe', colorDisplayName: { fr: 'Taupe Champagne', ar: 'شامبانيا توب', en: 'Champagne Taupe' }, colorCode: '#BFA893', images: ['/products/merya_top_white_1.jpg'], sizes: [{ size: 'Standard', stock: 25 }] },
          { colorName: 'Raven Black', colorDisplayName: { fr: 'Noir Corbeau', ar: 'أسود فاحم', en: 'Raven Black' }, colorCode: '#111111', images: ['/products/merya_dress_brown_2.jpg'], sizes: [{ size: 'Standard', stock: 30 }] }
        ]
      },
      {
        name: { fr: 'Robe Longue Plissée Zahra', ar: 'فستان زهرة الطويل المكسر', en: 'Zahra Tiered Pleated Maxi Dress' },
        slug: 'zahra-tiered-pleated-maxi-dress',
        description: { fr: 'Robe vaporeuse avec micro-plissage et doublure opaque ultra-douce.', ar: 'فستان طويل بكسرات ناعمة وبطانة مريحة غير شفافة.', en: 'Ethereal full-length dress with accordion micro-pleating and viscose lining.' },
        category: dressCat._id, sellingPrice: 9400, costPrice: 6000, isActive: true, isBestSeller: false,
        colors: [
          { colorName: 'Dusty Rose', colorDisplayName: { fr: 'Rose Poudré', ar: 'وردي مغبر', en: 'Dusty Rose' }, colorCode: '#C8A298', images: ['/products/merya_dress_pink_2.jpg'], sizes: [{ size: 'S', stock: 4 }, { size: 'M', stock: 6 }, { size: 'L', stock: 4 }] }
        ]
      },
      {
        name: { fr: 'Kimono Brodé en Organza Royal', ar: 'كيمونو أورجانزا مطرز ملكي', en: 'Royal Organza Embroidered Kimono' },
        slug: 'royal-organza-embroidered-kimono',
        description: { fr: 'Kimono somptueux avec broderies florales pour vos cérémonies.', ar: 'كيمونو فاخر للمناسبات بتطريزات نباتية أنيقة.', en: 'Opulent celebratory outer layer with tonal floral embroidery.' },
        category: kimonoCat._id, sellingPrice: 11500, costPrice: 7200, isActive: true, isBestSeller: true,
        colors: [
          { colorName: 'Golden Sand', colorDisplayName: { fr: 'Sable Doré', ar: 'رملي ذهبي', en: 'Golden Sand' }, colorCode: '#D4AF37', images: ['/products/merya_set_cape_1.jpg'], sizes: [{ size: 'S', stock: 5 }, { size: 'M', stock: 7 }, { size: 'L', stock: 3 }] },
          { colorName: 'Ivory Pearl', colorDisplayName: { fr: 'Perle Ivoire', ar: 'لؤلؤي عاجي', en: 'Ivory Pearl' }, colorCode: '#F4F0E8', images: ['/products/merya_skirt_silk_1.jpg'], sizes: [{ size: 'S', stock: 4 }, { size: 'M', stock: 8 }, { size: 'L', stock: 5 }] }
        ]
      }
    ]);
    log.push('5 products seeded successfully.');
  } else {
    log.push(`Products already exist (${productCount}), skipping.`);
  }

  // 5. Banners
  const bannerCount = await Banner.countDocuments();
  if (bannerCount === 0) {
    await Banner.insertMany([
      {
        title: { fr: 'Livraison express dans les 58 Wilayas | Paiement à la livraison', ar: 'توصيل سريع إلى 58 ولاية | الدفع عند الاستلام', en: 'Express delivery across all 58 Wilayas | Cash on Delivery' },
        subtitle: { fr: 'Commandez en toute confiance chez MERYA DZ', ar: 'تسوقي بكل ثقة مع ماريا ديزاد', en: 'Shop with full confidence at MERYA DZ' },
        buttonText: { fr: 'Découvrir', ar: 'اكتشفي الآن', en: 'Explore Now' },
        link: '/shop', image: '', placement: 'top_announcement', isActive: true, displayOrder: 1
      },
      {
        title: { fr: 'Collection Modeste & Élégante 2026', ar: 'تشكيلة الأناقة والحشمة 2026', en: 'Modest & Elegant Collection 2026' },
        subtitle: { fr: 'Des pièces intemporelles taillées dans les étoffes les plus nobles.', ar: 'أزياء خالدة محتشمة من أجود الأقمشة.', en: 'Timeless modest pieces tailored from the finest fabrics.' },
        buttonText: { fr: 'Voir la Collection', ar: 'تصفحي التشكيلة', en: 'Shop the Collection' },
        link: '/shop', image: '/products/merya_dress_blue_1.jpg', placement: 'home_hero', isActive: true, displayOrder: 1
      }
    ]);
    log.push('2 banners seeded.');
  } else {
    log.push(`Banners already exist (${bannerCount}), skipping.`);
  }

  return log;
}
