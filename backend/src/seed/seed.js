import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { Admin } from '../models/Admin.js';
import { Category } from '../models/Category.js';
import { Product } from '../models/Product.js';
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
  if ([3, 4, 7, 10, 12, 14, 17, 20, 28, 38, 40, 41, 45, 51, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69].includes(code)) return { homeFee: 850, agencyFee: 500 };
  if ([8, 30, 32, 39, 47, 55, 57, 58].includes(code)) return { homeFee: 1000, agencyFee: 700 };
  return { homeFee: 1400, agencyFee: 900 };
}

async function seedDatabase() {
  try {
    console.log('[Seed] Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('[Seed] Connected successfully.');

    // 1. Seed Delivery Settings (Singleton) with all 69 Algerian Wilayas
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
        agencyDeliveryFee: 500,
        homeDeliveryFee: 800,
        freeDeliveryThreshold: 0,
        wilayaRates
      });
      console.log('[Seed] Default delivery settings created with all 69 Wilaya rates.');
    } else if (!deliverySetting.wilayaRates || deliverySetting.wilayaRates.length < 69) {
      const existingCodes = new Set((deliverySetting.wilayaRates || []).map(r => r.wilayaCode));
      for (const rate of wilayaRates) {
        if (!existingCodes.has(rate.wilayaCode)) {
          deliverySetting.wilayaRates.push(rate);
        }
      }
      deliverySetting.wilayaRates.sort((a, b) => a.wilayaCode - b.wilayaCode);
      await deliverySetting.save();
      console.log(`[Seed] Updated existing delivery settings to ensure all 69 Wilaya rates are present.`);
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
          name: 'Luxury Abayas',
          slug: 'luxury-abayas',
          description: 'Handcrafted premium Nidha and Medina silk abayas designed with modesty and graceful silhouettes.',
          image: '/uploads/merya_dress_blue_1.jpg',
          displayOrder: 1,
          isActive: true
        },
        {
          name: 'Khimars & Hijabs',
          slug: 'khimars-and-hijabs',
          description: 'Breathable, non-slip Medina silk, modal, and premium chiffon scarves with flawless draping.',
          image: '/uploads/merya_dress_pink_1.jpg',
          displayOrder: 2,
          isActive: true
        },
        {
          name: 'Modest Co-ord Sets',
          slug: 'modest-co-ord-sets',
          description: 'Contemporary two-piece relaxed tailored sets designed for everyday elegance and effortless style.',
          image: '/uploads/merya_dress_brown_1.jpg',
          displayOrder: 3,
          isActive: true
        },
        {
          name: 'Flowing Dresses',
          slug: 'flowing-dresses',
          description: 'Tiered, pleated, and wrap-inspired full-coverage dresses crafted from lightweight breathable fabrics.',
          image: '/uploads/merya_dress_pink_2.jpg',
          displayOrder: 4,
          isActive: true
        },
        {
          name: 'Kimonos & Capes',
          slug: 'kimonos-and-capes',
          description: 'Graceful outer layers, embroidered kaftans, and textured dusters for special gatherings.',
          image: '/uploads/merya_dress_brown_2.jpg',
          displayOrder: 5,
          isActive: true
        }
      ]);
      console.log(`[Seed] Seeded ${categories.length} categories.`);
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
          name: 'The Noor Medina Silk Abaya',
          slug: 'the-noor-medina-silk-abaya',
          description: 'An iconic silhouette tailored from authentic Saudi Medina silk. Features flowing raglan sleeves with concealed snap buttons, a minimalist mandarin collar, and a matching tonal belt.',
          category: abayaCat._id,
          sellingPrice: 7500, // 7,500 DZD
          costPrice: 4800,    // 4,800 DZD (Cost for profit calculation)
          isActive: true,
          isBestSeller: true,
          colors: [
            {
              colorName: 'Warm Taupe',
              colorCode: '#B89C82',
              images: [
                'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?q=80&w=1000&auto=format&fit=crop',
                'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?q=80&w=1000&auto=format&fit=crop'
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
              colorCode: '#1F1E24',
              images: [
                'https://images.unsplash.com/photo-1509631179647-0177331693ae?q=80&w=1000&auto=format&fit=crop',
                'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=1000&auto=format&fit=crop'
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
              colorCode: '#737C68',
              images: [
                'https://images.unsplash.com/photo-1551803091-e20673f15770?q=80&w=1000&auto=format&fit=crop'
              ],
              sizes: [
                { size: 'S', stock: 5 },
                { size: 'M', stock: 7 },
                { size: 'L', stock: 4 },
                { size: 'XL', stock: 0 }
              ]
            }
          ]
        },
        {
          name: 'Layla 2-Piece Linen Co-Ord',
          slug: 'layla-2-piece-linen-co-ord',
          description: 'Engineered for modern modest everyday living. A relaxed longline tunic tunic paired with tailored wide-leg trousers crafted from premium washed linen blend.',
          category: setsCat._id,
          sellingPrice: 8900, // 8,900 DZD
          costPrice: 5400,    // 5,400 DZD
          isActive: true,
          isBestSeller: true,
          colors: [
            {
              colorName: 'Sand Beige',
              colorCode: '#D8C7B5',
              images: [
                'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=1000&auto=format&fit=crop',
                'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?q=80&w=1000&auto=format&fit=crop'
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
              colorCode: '#4A3B32',
              images: [
                'https://images.unsplash.com/photo-1496747611176-843222e1e57c?q=80&w=1000&auto=format&fit=crop'
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
          name: 'Amina Triangle French Khimar',
          slug: 'amina-triangle-french-khimar',
          description: 'Double-layer pointed French khimar cut from ultra-breathable Wool Peach fabric. Features integrated tie-back head straps and seamless niqab strings.',
          category: khimarCat._id,
          sellingPrice: 3200, // 3,200 DZD
          costPrice: 1600,    // 1,600 DZD
          isActive: true,
          isBestSeller: true,
          colors: [
            {
              colorName: 'Champagne Taupe',
              colorCode: '#BFA893',
              images: [
                'https://images.unsplash.com/photo-1609357605129-26f69add5d6e?q=80&w=1000&auto=format&fit=crop'
              ],
              sizes: [
                { size: 'Standard', stock: 25 }
              ]
            },
            {
              colorName: 'Raven Black',
              colorCode: '#111111',
              images: [
                'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?q=80&w=1000&auto=format&fit=crop'
              ],
              sizes: [
                { size: 'Standard', stock: 30 }
              ]
            },
            {
              colorName: 'Soft Sage',
              colorCode: '#9AA088',
              images: [
                'https://images.unsplash.com/photo-1551803091-e20673f15770?q=80&w=1000&auto=format&fit=crop'
              ],
              sizes: [
                { size: 'Standard', stock: 15 }
              ]
            }
          ]
        },
        {
          name: 'Zahra Tiered Pleated Maxi Dress',
          slug: 'zahra-tiered-pleated-maxi-dress',
          description: 'An ethereal full-length dress showcasing delicate accordion micro-pleating and generous fabric flare. Lined with ultra-soft viscose for opaque coverage.',
          category: dressCat._id,
          sellingPrice: 9400, // 9,400 DZD
          costPrice: 6000,    // 6,000 DZD
          isActive: true,
          isBestSeller: false,
          colors: [
            {
              colorName: 'Dusty Rose',
              colorCode: '#C8A298',
              images: [
                'https://images.unsplash.com/photo-1496747611176-843222e1e57c?q=80&w=1000&auto=format&fit=crop'
              ],
              sizes: [
                { size: 'S', stock: 4 },
                { size: 'M', stock: 6 },
                { size: 'L', stock: 4 }
              ]
            },
            {
              colorName: 'Caramel Macchiato',
              colorCode: '#8E674F',
              images: [
                'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=1000&auto=format&fit=crop'
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
          name: 'Royal Organza Embroidered Kimono',
          slug: 'royal-organza-embroidered-kimono',
          description: 'An opulent celebratory outer layer featuring tonal floral embroidery across the hemline and cuffs. Finished with delicate hand-knotted buttons.',
          category: kimonoCat._id,
          sellingPrice: 11500, // 11,500 DZD
          costPrice: 7200,     // 7,200 DZD
          isActive: true,
          isBestSeller: true,
          colors: [
            {
              colorName: 'Golden Sand',
              colorCode: '#D4AF37',
              images: [
                'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?q=80&w=1000&auto=format&fit=crop'
              ],
              sizes: [
                { size: 'S', stock: 5 },
                { size: 'M', stock: 7 },
                { size: 'L', stock: 3 }
              ]
            },
            {
              colorName: 'Ivory Pearl',
              colorCode: '#F4F0E8',
              images: [
                'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?q=80&w=1000&auto=format&fit=crop'
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
      console.log(`[Seed] Seeded ${products.length} products with complete color-size matrices.`);
    }

    console.log('[Seed] Database seeding completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('[Seed Error]:', error);
    process.exit(1);
  }
}

seedDatabase();
