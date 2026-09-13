import { connectDB } from './src/config/db.js';
import { Product } from './src/models/Product.js';

async function run() {
  await connectDB();
  
  const updates = [
    {
      slug: 'the-noor-medina-silk-abaya',
      colors: [
        { colorName: 'Sky Blue & Gold', colorCode: '#3D5A80', images: ['/products/merya_dress_blue_1.jpg'] },
        { colorName: 'Warm Espresso & Brown', colorCode: '#6F4E37', images: ['/products/merya_dress_brown_1.jpg', '/products/merya_dress_brown_2.jpg'] },
        { colorName: 'Rose Dust & Blush', colorCode: '#D4A373', images: ['/products/merya_dress_pink_1.jpg', '/products/merya_dress_pink_2.jpg'] }
      ]
    },
    {
      slug: 'layla-2-piece-linen-co-ord',
      colors: [
        { colorName: 'Warm Bronze Mocha', colorCode: '#6F4E37', images: ['/products/merya_dress_brown_1.jpg', '/products/merya_dress_brown_2.jpg'] },
        { colorName: 'Soft Blush Petal', colorCode: '#D4A373', images: ['/products/merya_dress_pink_1.jpg'] }
      ]
    },
    {
      slug: 'amina-triangle-french-khimar',
      colors: [
        { colorName: 'Rose Petal Silk', colorCode: '#D4A373', images: ['/products/merya_dress_pink_1.jpg', '/products/merya_dress_pink_2.jpg'] },
        { colorName: 'Imperial Blue Silk', colorCode: '#3D5A80', images: ['/products/merya_dress_blue_1.jpg'] },
        { colorName: 'Espresso Bronze Silk', colorCode: '#6F4E37', images: ['/products/merya_dress_brown_2.jpg'] }
      ]
    },
    {
      slug: 'zahra-tiered-pleated-maxi-dress',
      colors: [
        { colorName: 'Blush Rose Gold', colorCode: '#D4A373', images: ['/products/merya_dress_pink_2.jpg', '/products/merya_dress_pink_1.jpg'] },
        { colorName: 'Celestial Blue', colorCode: '#3D5A80', images: ['/products/merya_dress_blue_1.jpg'] }
      ]
    },
    {
      slug: 'royal-organza-embroidered-kimono',
      colors: [
        { colorName: 'Mocha Bronze Embroidered', colorCode: '#6F4E37', images: ['/products/merya_dress_brown_2.jpg', '/products/merya_dress_brown_1.jpg'] },
        { colorName: 'Royal Blue Embroidered', colorCode: '#3D5A80', images: ['/products/merya_dress_blue_1.jpg'] }
      ]
    }
  ];

  for (const item of updates) {
    const prod = await Product.findOne({ slug: item.slug });
    if (prod && prod.colors) {
      for (let i = 0; i < item.colors.length; i++) {
        if (prod.colors[i]) {
          prod.colors[i].colorName = item.colors[i].colorName;
          prod.colors[i].colorCode = item.colors[i].colorCode;
          prod.colors[i].images = item.colors[i].images;
        }
      }
      await prod.save();
      console.log(`Updated product: ${item.slug}`);
    }
  }

  console.log('All products updated successfully to use ONLY user uploaded photos.');
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
