import { connectDB } from './src/config/db.js';
import { Category } from './src/models/Category.js';

async function updateLandingCategories() {
  await connectDB();

  // The 4 requested categories for landing page:
  // 1. Dresses (Robes)
  // 2. Tops (Hauts)
  // 3. Skirts (Jupes)
  // 4. Ensembles (Co-ords)

  const requestedCategories = [
    {
      name: 'Dresses',
      slug: 'dresses',
      description: 'Elegant, graceful full-length modest dresses crafted from fluid breathable fabrics.',
      image: '/products/merya_dress_cream_1.jpg',
      displayOrder: 1,
      isActive: true,
      isArchived: false
    },
    {
      name: 'Tops',
      slug: 'tops',
      description: 'Tailored modest jackets, high-neck blouses, and elegant longline tops.',
      image: '/products/merya_top_white_1.jpg',
      displayOrder: 2,
      isActive: true,
      isArchived: false
    },
    {
      name: 'Skirts',
      slug: 'skirts',
      description: 'Flowing accordion pleats and full A-line silhouettes with modest coverage.',
      image: '/products/merya_skirt_beige.jpg',
      displayOrder: 3,
      isActive: true,
      isArchived: false
    },
    {
      name: 'Ensembles',
      slug: 'ensembles',
      description: 'Coordinated two-piece modest sets designed for effortless contemporary poise.',
      image: '/products/merya_ensemble_set.jpg',
      displayOrder: 4,
      isActive: true,
      isArchived: false
    }
  ];

  for (const catData of requestedCategories) {
    const existing = await Category.findOne({ slug: catData.slug });
    if (existing) {
      existing.name = catData.name;
      existing.image = catData.image;
      existing.description = catData.description;
      existing.displayOrder = catData.displayOrder;
      existing.isActive = true;
      existing.isArchived = false;
      await existing.save();
      console.log(`Updated existing category: ${catData.name}`);
    } else {
      await Category.create(catData);
      console.log(`Created new category: ${catData.name}`);
    }
  }

  // De-prioritize other categories displayOrder so these 4 are always the first 4 on the landing page
  await Category.updateMany(
    { slug: { $nin: ['dresses', 'tops', 'skirts', 'ensembles'] } },
    { $set: { displayOrder: 10 } }
  );

  const activeCats = await Category.find({ isArchived: false, isActive: true }).sort({ displayOrder: 1 });
  console.log('\nActive Categories in DB:');
  console.log(activeCats.map(c => ({ order: c.displayOrder, name: c.name, slug: c.slug, image: c.image })));

  process.exit(0);
}

updateLandingCategories().catch(err => {
  console.error(err);
  process.exit(1);
});
