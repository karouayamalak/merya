import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { Admin } from '../models/Admin.js';
import { Category } from '../models/Category.js';
import { Product } from '../models/Product.js';
import { Banner } from '../models/Banner.js';
import { DeliverySetting } from '../models/DeliverySetting.js';
import { ROLES, ALGERIA_WILAYAS } from '../config/constants.js';

dotenv.config();

if (!process.env.MONGODB_URI) {
  console.error('[Seed Error] FATAL: MONGODB_URI environment variable is required. Refusing to connect to an unspecified database.');
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI;

function getDefaultWilayaRates(code) {
  if (code === 16) return { homeFee: 500, agencyFee: 350 };
  if ([9, 35, 42].includes(code)) return { homeFee: 600, agencyFee: 400 };
  if ([31, 25, 19, 15, 6, 23, 13, 27, 2, 5, 18, 21, 22, 24, 26, 29, 34, 43, 44, 46, 48].includes(code)) return { homeFee: 750, agencyFee: 450 };
  if ([3, 4, 7, 10, 12, 14, 17, 20, 28, 38, 40, 41, 45, 51].includes(code)) return { homeFee: 850, agencyFee: 500 };
  if ([8, 30, 32, 39, 47, 55, 57, 58].includes(code)) return { homeFee: 1000, agencyFee: 700 };
  return { homeFee: 1400, agencyFee: 900 };
}

async function seedDatabase() {
  try {
    console.log('[Seed] Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('[Seed] Connected successfully.');

    // 1. Seed Delivery Settings (Singleton) with all 58 Algerian Wilayas
    let deliverySetting = await DeliverySetting.findOne();
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

    if (!deliverySetting) {
      deliverySetting = await DeliverySetting.create({
        singletonKey: 'default',
        freeDeliveryThreshold: 0,
        wilayaRates
      });
      console.log('[Seed] Default delivery settings created with all 58 Wilaya rates.');
    } else {
      // Ensure exactly the 58 canonical wilayas are present (filter out any > 58 codes safely)
      const existingMap = new Map((deliverySetting.wilayaRates || []).map(r => [r.wilayaCode, r]));
      const normalizedRates = ALGERIA_WILAYAS.map(w => {
        if (existingMap.has(w.code)) {
          const ex = existingMap.get(w.code);
          return {
            wilayaCode: w.code,
            wilayaName: w.name,
            wilayaNameAr: w.nameAr,
            homeFee: ex.homeFee,
            agencyFee: ex.agencyFee,
            isAvailable: ex.isAvailable !== false
          };
        }
        const d = getDefaultWilayaRates(w.code);
        return {
          wilayaCode: w.code,
          wilayaName: w.name,
          wilayaNameAr: w.nameAr,
          homeFee: d.homeFee,
          agencyFee: d.agencyFee,
          isAvailable: true
        };
      }).sort((a, b) => a.wilayaCode - b.wilayaCode);

      deliverySetting.wilayaRates = normalizedRates;
      await deliverySetting.save();
      console.log(`[Seed] Delivery settings normalized to exactly 58 canonical Wilaya rates.`);
    }

    // 2. Seed Initial Admin User (Credentials strictly sourced from environment)
    const adminEmail = process.env.INITIAL_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
    const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

    if (adminEmail && adminPassword) {
      const existingAdmin = await Admin.findOne({ email: adminEmail.toLowerCase() });
      if (!existingAdmin) {
        const salt = await bcrypt.genSalt(12);
        const passwordHash = await bcrypt.hash(adminPassword, salt);

        await Admin.create({
          username: process.env.INITIAL_ADMIN_USERNAME || 'Store Owner',
          email: adminEmail.toLowerCase(),
          passwordHash,
          role: ROLES.OWNER,
          isActive: true
        });
        console.log(`[Seed] Initial admin user created successfully for: ${adminEmail.toLowerCase()}`);
      } else {
        console.log(`[Seed] Admin user already exists for: ${adminEmail.toLowerCase()}`);
      }
    } else {
      const adminCount = await Admin.countDocuments();
      if (adminCount === 0) {
        console.log('[Seed] Notice: No INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD provided. Skipping initial admin creation.');
      } else {
        console.log(`[Seed] ${adminCount} administrator account(s) already exist in database.`);
      }
    }

    // 3. Seed Categories if empty
    const categoryCount = await Category.countDocuments();
    let categories = [];
    if (categoryCount === 0) {
      categories = await Category.insertMany([
        {
          name: {
            fr: 'Abayas de Luxe',
            ar: 'عبايات فاخرة',
            en: 'Luxury Abayas'
          },
          slug: 'luxury-abayas',
          description: {
            fr: 'Abayas haut de gamme confectionnées en soie de Médine et Nidha avec une coupe modeste et élégante.',
            ar: 'عبايات فاخرة مصنوعة من حرير المدينة والندى مصممة بحشمة وأناقة راقية.',
            en: 'Handcrafted premium Nidha and Medina silk abayas designed with modesty and graceful silhouettes.'
          },
          image: '/products/merya_dress_blue_1.jpg',
          displayOrder: 1,
          isActive: true
        },
        {
          name: {
            fr: 'Khimars & Hijabs',
            ar: 'خمارات وحجابات',
            en: 'Khimars & Hijabs'
          },
          slug: 'khimars-and-hijabs',
          description: {
            fr: 'Foulards et khimars respirants en soie de Médine, modal et mousseline haut de gamme.',
            ar: 'أوشحة وخمارات حرير المدينة الفاخر والمودال والشيفون بانسيابية مثالية.',
            en: 'Breathable, non-slip Medina silk, modal, and premium chiffon scarves with flawless draping.'
          },
          image: '/products/merya_dress_pink_1.jpg',
          displayOrder: 2,
          isActive: true
        },
        {
          name: {
            fr: 'Ensembles Mastour',
            ar: 'أطقم محتشمة',
            en: 'Modest Co-ord Sets'
          },
          slug: 'modest-co-ord-sets',
          description: {
            fr: 'Ensembles deux pièces décontractés et élégants conçus pour le quotidien mastour.',
            ar: 'أطقم نسائية محتشمة وعصرية مكونة من قطعتين لإطلالة يومية راقية.',
            en: 'Contemporary two-piece relaxed tailored sets designed for everyday elegance and effortless style.'
          },
          image: '/products/merya_dress_brown_1.jpg',
          displayOrder: 3,
          isActive: true
        },
        {
          name: {
            fr: 'Robes Évasées',
            ar: 'فساتين انسيابية',
            en: 'Flowing Dresses'
          },
          slug: 'flowing-dresses',
          description: {
            fr: 'Robes longues fluides confectionnées dans des tissus légers et respirants.',
            ar: 'فساتين محتشمة واسعة مصنوعة من أقمشة خفيفة ومريحة.',
            en: 'Tiered, pleated, and wrap-inspired full-coverage dresses crafted from lightweight breathable fabrics.'
          },
          image: '/products/merya_dress_pink_2.jpg',
          displayOrder: 4,
          isActive: true
        },
        {
          name: {
            fr: 'Kimonos & Capes',
            ar: 'كيمونو وكاب',
            en: 'Kimonos & Capes'
          },
          slug: 'kimonos-and-capes',
          description: {
            fr: 'Kaftans brodés, capes et kimonos élégants pour sublimer vos tenues de cérémonie.',
            ar: 'عباءات كيمونو وكاب مطرزة بتصاميم راقية للمناسبات الخاصة.',
            en: 'Graceful outer layers, embroidered kaftans, and textured dusters for special gatherings.'
          },
          image: '/products/merya_dress_brown_2.jpg',
          displayOrder: 5,
          isActive: true
        }
      ]);
      console.log(`[Seed] Seeded ${categories.length} categories with complete FR/AR/EN translations.`);
    } else {
      categories = await Category.find();
    }

    // 4. Seed Products if empty
    const productCount = await Product.countDocuments();
    if (productCount === 0 && categories.length > 0) {
      const abayaCat = categories.find(c => c.slug === 'luxury-abayas') || categories[0];
      const khimarCat = categories.find(c => c.slug === 'khimars-and-hijabs') || categories[1];
      const setsCat = categories.find(c => c.slug === 'modest-co-ord-sets') || categories[2];
      const dressCat = categories.find(c => c.slug === 'flowing-dresses') || categories[3];
      const kimonoCat = categories.find(c => c.slug === 'kimonos-and-capes') || categories[4];

      const products = [
        {
          name: {
            fr: 'Abaya en Soie de Médine Noor',
            ar: 'عباية نور من حرير المدينة',
            en: 'The Noor Medina Silk Abaya'
          },
          slug: 'the-noor-medina-silk-abaya',
          description: {
            fr: 'Silhouette emblématique confectionnée en soie de Médine authentique. Manches raglan fluides avec boutons-pression dissimulés et ceinture ton sur ton.',
            ar: 'تصميم أيقوني مصنوع من حرير المدينة الأصيل مع أكمام انسيابية وأزرار مخفية وحزام متناسق.',
            en: 'An iconic silhouette tailored from authentic Saudi Medina silk. Features flowing raglan sleeves with concealed snap buttons and a tonal belt.'
          },
          category: abayaCat._id,
          sellingPrice: 7500, // 7,500 DZD
          costPrice: 4800,    // 4,800 DZD
          isActive: true,
          isBestSeller: true,
          colors: [
            {
              colorName: 'Warm Taupe',
              colorDisplayName: {
                fr: 'Taupe Chaud',
                ar: 'رمادي داكن دافئ',
                en: 'Warm Taupe'
              },
              colorCode: '#B89C82',
              images: [
                '/products/merya_dress_blue_1.jpg',
                '/products/merya_dress_brown_1.jpg'
              ],
              sizes: [
                { size: 'S', stock: 8 },
                { size: 'M', stock: 12 },
                { size: 'L', stock: 6 },
                { size: 'XL', stock: 4 }
              ]
            },
            {
              colorName: 'Midnight Noir',
              colorDisplayName: {
                fr: 'Noir Minuit',
                ar: 'أسود داكن',
                en: 'Midnight Noir'
              },
              colorCode: '#1F1E24',
              images: [
                '/products/merya_dress_brown_2.jpg'
              ],
              sizes: [
                { size: 'S', stock: 10 },
                { size: 'M', stock: 15 },
                { size: 'L', stock: 8 },
                { size: 'XL', stock: 3 }
              ]
            },
            {
              colorName: 'Muted Olive',
              colorDisplayName: {
                fr: 'Olive Poudré',
                ar: 'زيتوني هادئ',
                en: 'Muted Olive'
              },
              colorCode: '#737C68',
              images: [
                '/products/merya_dress_pink_1.jpg'
              ],
              sizes: [
                { size: 'S', stock: 5 },
                { size: 'M', stock: 7 },
                { size: 'L', stock: 4 },
                { size: 'XL', stock: 2 }
              ]
            }
          ]
        },
        {
          name: {
            fr: 'Ensemble 2 Pièces en Lin Layla',
            ar: 'طقم ليلى قطعتين من الكتان',
            en: 'Layla 2-Piece Linen Co-Ord'
          },
          slug: 'layla-2-piece-linen-co-ord',
          description: {
            fr: 'Conçu pour le quotidien mastour moderne. Tunique longue décontractée assortie d’un pantalon large confectionné dans un mélange de lin lavé.',
            ar: 'طقم أنيق مصمم للحياة اليومية المحتشمة. سترة طويلة مع بنطال واسع مريح مصنوع من مزيج الكتان الفاخر.',
            en: 'Engineered for modern modest everyday living. A relaxed longline tunic paired with tailored wide-leg trousers crafted from premium washed linen blend.'
          },
          category: setsCat._id,
          sellingPrice: 8900, // 8,900 DZD
          costPrice: 5400,    // 5,400 DZD
          isActive: true,
          isBestSeller: true,
          colors: [
            {
              colorName: 'Sand Beige',
              colorDisplayName: {
                fr: 'Beige Sable',
                ar: 'بيج رملي',
                en: 'Sand Beige'
              },
              colorCode: '#D8C7B5',
              images: [
                '/products/merya_ensemble_set.jpg',
                '/products/merya_skirt_beige.jpg'
              ],
              sizes: [
                { size: 'S', stock: 6 },
                { size: 'M', stock: 9 },
                { size: 'L', stock: 5 },
                { size: 'XL', stock: 2 }
              ]
            },
            {
              colorName: 'Deep Mocha',
              colorDisplayName: {
                fr: 'Moka Profond',
                ar: 'موكا عميق',
                en: 'Deep Mocha'
              },
              colorCode: '#4A3B32',
              images: [
                '/products/merya_dress_brown_1.jpg'
              ],
              sizes: [
                { size: 'S', stock: 4 },
                { size: 'M', stock: 8 },
                { size: 'L', stock: 3 },
                { size: 'XL', stock: 1 }
              ]
            }
          ]
        },
        {
          name: {
            fr: 'Khimar Pointu Triangle Amina',
            ar: 'خمار أمينة المثلث',
            en: 'Amina Triangle French Khimar'
          },
          slug: 'amina-triangle-french-khimar',
          description: {
            fr: 'Khimar triangle double couche en tissu Wool Peach ultra-respirant avec attaches intégrées et maintien impeccable.',
            ar: 'خمار مثلث من طبقتين من قماش الخوخ الفاخر فائق النعومة والتهوية مع أربطة رأس مريحة وانسيابية تامة.',
            en: 'Double-layer pointed French khimar cut from ultra-breathable Wool Peach fabric. Features integrated tie-back head straps and seamless strings.'
          },
          category: khimarCat._id,
          sellingPrice: 3200, // 3,200 DZD
          costPrice: 1600,    // 1,600 DZD
          isActive: true,
          isBestSeller: true,
          colors: [
            {
              colorName: 'Champagne Taupe',
              colorDisplayName: {
                fr: 'Taupe Champagne',
                ar: 'شامبانيا توب',
                en: 'Champagne Taupe'
              },
              colorCode: '#BFA893',
              images: [
                '/products/merya_top_white_1.jpg'
              ],
              sizes: [
                { size: 'Standard', stock: 25 }
              ]
            },
            {
              colorName: 'Raven Black',
              colorDisplayName: {
                fr: 'Noir Corbeau',
                ar: 'أسود فاحم',
                en: 'Raven Black'
              },
              colorCode: '#111111',
              images: [
                '/products/merya_dress_brown_2.jpg'
              ],
              sizes: [
                { size: 'Standard', stock: 30 }
              ]
            }
          ]
        },
        {
          name: {
            fr: 'Robe Longue Plissée Zahra',
            ar: 'فستان زهرة الطويل المكسر',
            en: 'Zahra Tiered Pleated Maxi Dress'
          },
          slug: 'zahra-tiered-pleated-maxi-dress',
          description: {
            fr: 'Robe longue vaporeuse avec micro-plissage accordéon délicat et doublure opaque ultra-douce pour une couverture parfaite.',
            ar: 'فستان طويل وفضفاض بكسرات ناعمة وخامة انسيابية مع بطانة مريحة وغير شفافة تعكس الرقي.',
            en: 'An ethereal full-length dress showcasing delicate accordion micro-pleating and generous fabric flare. Lined with ultra-soft viscose for opaque coverage.'
          },
          category: dressCat._id,
          sellingPrice: 9400, // 9,400 DZD
          costPrice: 6000,    // 6,000 DZD
          isActive: true,
          isBestSeller: false,
          colors: [
            {
              colorName: 'Dusty Rose',
              colorDisplayName: {
                fr: 'Rose Poudré',
                ar: 'وردي مغبر',
                en: 'Dusty Rose'
              },
              colorCode: '#C8A298',
              images: [
                '/products/merya_dress_pink_2.jpg'
              ],
              sizes: [
                { size: 'S', stock: 4 },
                { size: 'M', stock: 6 },
                { size: 'L', stock: 4 }
              ]
            },
            {
              colorName: 'Caramel Macchiato',
              colorDisplayName: {
                fr: 'Caramel Macchiato',
                ar: 'كراميل ماكياتو',
                en: 'Caramel Macchiato'
              },
              colorCode: '#8E674F',
              images: [
                '/products/merya_dress_cream_1.jpg'
              ],
              sizes: [
                { size: 'S', stock: 3 },
                { size: 'M', stock: 5 },
                { size: 'L', stock: 2 }
              ]
            }
          ]
        },
        {
          name: {
            fr: 'Kimono Brodé en Organza Royal',
            ar: 'كيمونو أورجانزا مطرز ملكي',
            en: 'Royal Organza Embroidered Kimono'
          },
          slug: 'royal-organza-embroidered-kimono',
          description: {
            fr: 'Pièce somptueuse pour vos cérémonies avec broderies florales raffinées sur l’ourlet et les poignets. Boutons faits main.',
            ar: 'كيمونو راقي وفاخر للمناسبات مزين بتطريزات نباتية أنيقة عند الأطراف والأكمام مع أزرار يدوية الصنع.',
            en: 'An opulent celebratory outer layer featuring tonal floral embroidery across the hemline and cuffs. Finished with delicate hand-knotted buttons.'
          },
          category: kimonoCat._id,
          sellingPrice: 11500, // 11,500 DZD
          costPrice: 7200,     // 7,200 DZD
          isActive: true,
          isBestSeller: true,
          colors: [
            {
              colorName: 'Golden Sand',
              colorDisplayName: {
                fr: 'Sable Doré',
                ar: 'رملي ذهبي',
                en: 'Golden Sand'
              },
              colorCode: '#D4AF37',
              images: [
                '/products/merya_set_cape_1.jpg'
              ],
              sizes: [
                { size: 'S', stock: 5 },
                { size: 'M', stock: 7 },
                { size: 'L', stock: 3 }
              ]
            },
            {
              colorName: 'Ivory Pearl',
              colorDisplayName: {
                fr: 'Perle Ivoire',
                ar: 'لؤلؤي عاجي',
                en: 'Ivory Pearl'
              },
              colorCode: '#F4F0E8',
              images: [
                '/products/merya_skirt_silk_1.jpg'
              ],
              sizes: [
                { size: 'S', stock: 4 },
                { size: 'M', stock: 8 },
                { size: 'L', stock: 5 }
              ]
            }
          ]
        }
      ];

      await Product.insertMany(products);
      console.log(`[Seed] Seeded ${products.length} products with complete multilingual metadata and local assets.`);
    }

    // 5. Seed Banners if empty
    const bannerCount = await Banner.countDocuments();
    if (bannerCount === 0) {
      await Banner.insertMany([
        {
          title: {
            fr: 'Livraison express dans les 58 Wilayas | Paiement à la livraison',
            ar: 'توصيل سريع متوفر إلى 58 ولاية | الدفع عند الاستلام',
            en: 'Express delivery available across all 58 Wilayas | Cash on Delivery'
          },
          subtitle: {
            fr: 'Commandez en toute confiance chez MERYA DZ',
            ar: 'تسوقي بكل ثقة وأمان مع ماريا ديزاد',
            en: 'Shop with full confidence at MERYA DZ'
          },
          buttonText: {
            fr: 'Découvrir',
            ar: 'اكتشفي الآن',
            en: 'Explore Now'
          },
          link: '/shop',
          image: '',
          placement: 'top_announcement',
          isActive: true,
          displayOrder: 1
        },
        {
          title: {
            fr: 'Collection Modeste & Élégante 2026',
            ar: 'تشكيلة الأناقة والحشمة 2026',
            en: 'Modest & Elegant Collection 2026'
          },
          subtitle: {
            fr: 'Des pièces intemporelles taillées dans les étoffes les plus nobles.',
            ar: 'أزياء خالدة محتشمة مصنوعة من أجود أنواع الأقمشة الفاخرة.',
            en: 'Timeless modest pieces tailored from the finest fabrics.'
          },
          buttonText: {
            fr: 'Voir la Collection',
            ar: 'تصفحي التشكيلة',
            en: 'Shop the Collection'
          },
          link: '/shop',
          image: '/products/merya_dress_blue_1.jpg',
          placement: 'home_hero',
          isActive: true,
          displayOrder: 1
        }
      ]);
      console.log('[Seed] Seeded initial promotional banners with full FR/AR/EN translations.');
    }

    console.log('[Seed] Database seeding completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('[Seed Error]:', error);
    process.exit(1);
  }
}

seedDatabase();
