import { Product } from '../models/Product.js';
import { Category } from '../models/Category.js';
import { Order } from '../models/Order.js';
import { ORDER_STATUS } from '../config/constants.js';

// Public: Get active products with filtering, search, and pagination
export const getProducts = async (req, res, next) => {
  try {
    const { category, isBestSeller, search, minPrice, maxPrice, page = 1, limit = 24 } = req.query;

    const filter = {
      isActive: true,
      isArchived: false
    };

    if (category) {
      // Allow filtering by either category ID or category slug
      const catDoc = await Category.findOne({
        $or: [{ _id: category.match(/^[0-9a-fA-F]{24}$/) ? category : null }, { slug: category }]
      });
      if (catDoc) {
        filter.category = catDoc._id;
      }
    }

    if (isBestSeller === 'true') {
      filter.isBestSeller = true;
    }

    if (search && search.trim()) {
      filter.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { description: { $regex: search.trim(), $options: 'i' } }
      ];
    }

    if (minPrice || maxPrice) {
      filter.sellingPrice = {};
      if (minPrice) filter.sellingPrice.$gte = Number(minPrice);
      if (maxPrice) filter.sellingPrice.$lte = Number(maxPrice);
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [products, total] = await Promise.all([
      Product.find(filter)
        .select('-costPrice') // Do not expose cost price to public!
        .populate('category', 'name slug')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Product.countDocuments(filter)
    ]);

    res.json({
      success: true,
      products,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
};

// Public: Get single product by slug
export const getProductBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const product = await Product.findOne({ slug, isActive: true, isArchived: false })
      .select('-costPrice')
      .populate('category', 'name slug');

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Related products in the same category
    const relatedProducts = await Product.find({
      category: product.category._id,
      _id: { $ne: product._id },
      isActive: true,
      isArchived: false
    })
      .select('-costPrice')
      .limit(4);

    res.json({ success: true, product, relatedProducts });
  } catch (error) {
    next(error);
  }
};

// Admin: Get all products with costPrice and total stock calculation
export const getAllProductsAdmin = async (req, res, next) => {
  try {
    const { search, category, isActive, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (search && search.trim()) {
      filter.name = { $regex: search.trim(), $options: 'i' };
    }
    if (category) filter.category = category;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [products, total] = await Promise.all([
      Product.find(filter)
        .populate('category', 'name slug')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Product.countDocuments(filter)
    ]);

    // Calculate aggregate stock across all color/size variants for quick overview
    const enrichedProducts = products.map(p => {
      const doc = p.toObject();
      let totalStock = 0;
      doc.colors.forEach(c => {
        c.sizes.forEach(s => {
          totalStock += s.stock;
        });
      });
      doc.totalStock = totalStock;
      return doc;
    });

    res.json({
      success: true,
      products: enrichedProducts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Get single product by ID
export const getProductByIdAdmin = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id).populate('category', 'name slug');
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    res.json({ success: true, product });
  } catch (error) {
    next(error);
  }
};

// Admin: Create product
export const createProduct = async (req, res, next) => {
  try {
    const { name, description, category, sellingPrice, costPrice, isActive, isBestSeller, colors } = req.body;

    const baseSlug = name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    let slug = baseSlug;
    let counter = 1;
    while (await Product.findOne({ slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    // Strip any client-provided stock values — inventory boundary enforcement.
    // All new variants always start at stock = 0.
    // Stock must be set through the inventory adjustment endpoint (POST /admin/inventory/adjust).
    const sanitizedColors = (colors || []).map(color => ({
      colorName: color.colorName,
      colorCode: color.colorCode,
      images: color.images || [],
      sizes: (color.sizes || []).map(s => ({
        size: s.size,
        stock: 0   // always zero regardless of what the client sends
      }))
    }));

    const product = new Product({
      name,
      slug,
      description,
      category,
      sellingPrice,
      costPrice,
      isActive: isActive !== undefined ? isActive : true,
      isBestSeller: !!isBestSeller,
      colors: sanitizedColors
    });

    await product.save();
    res.status(201).json({ success: true, product });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A product with this name or slug already exists. Please choose a distinct name.'
      });
    }
    next(error);
  }
};


// Admin: Update product
export const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, category, sellingPrice, costPrice, isActive, isBestSeller, isArchived, colors } = req.body;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    if (name && name !== product.name) {
      product.name = name;
      // update slug cleanly if name changes
      const baseSlug = name
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');

      let newSlug = baseSlug;
      let counter = 1;
      while (await Product.findOne({ slug: newSlug, _id: { $ne: product._id } })) {
        newSlug = `${baseSlug}-${counter}`;
        counter++;
      }
      product.slug = newSlug;
    }

    if (description !== undefined) product.description = description;
    if (category !== undefined) product.category = category;
    if (sellingPrice !== undefined) product.sellingPrice = sellingPrice;
    if (costPrice !== undefined) product.costPrice = costPrice;
    if (isActive !== undefined) product.isActive = isActive;
    if (isBestSeller !== undefined) product.isBestSeller = isBestSeller;
    if (isArchived === true && !product.isArchived) {
      const activeOrders = await Order.find({
        "items.productId": product._id,
        status: {
          $in: [
            ORDER_STATUS.PENDING,
            ORDER_STATUS.CONFIRMED,
            ORDER_STATUS.ON_THE_WAY,
            ORDER_STATUS.AT_AGENCY
          ]
        }
      }).lean();

      if (activeOrders.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'Cannot archive product: There are active undelivered orders referencing this product.'
        });
      }
      product.isArchived = true;
    } else if (isArchived !== undefined) {
      product.isArchived = isArchived;
    }

    if (colors !== undefined) {
      // 1. Protect active orders from destructive variant removal or rename
      const activeOrders = await Order.find({
        "items.productId": product._id,
        status: {
          $in: [
            ORDER_STATUS.PENDING,
            ORDER_STATUS.CONFIRMED,
            ORDER_STATUS.ON_THE_WAY,
            ORDER_STATUS.AT_AGENCY
          ]
        }
      }).lean();

      for (const order of activeOrders) {
        for (const item of order.items) {
          if (item.productId.toString() === product._id.toString()) {
            const incomingColor = colors.find(c => c.colorName === item.colorName);
            const incomingSize = incomingColor?.sizes?.find(s => s.size === item.size);
            if (!incomingColor || !incomingSize) {
              return res.status(409).json({
                success: false,
                message: `Cannot remove variant: ${item.colorName} / ${item.size}. There are active orders referencing this variant.`
              });
            }
          }
        }
      }

      // 2. Prevent stock mutation through product update endpoint:
      // Authoritative stock MUST be preserved from the database for existing variants.
      // Brand new variants default to 0 stock until set via adjustVariantStock / setStockAtomic.
      product.colors = colors.map(incomingColor => {
        const existingColor = product.colors.find(c => c.colorName === incomingColor.colorName);
        return {
          colorName: incomingColor.colorName,
          colorCode: incomingColor.colorCode,
          images: incomingColor.images || [],
          sizes: (incomingColor.sizes || []).map(incomingSize => {
            const existingSize = existingColor?.sizes?.find(s => s.size === incomingSize.size);
            return {
              size: incomingSize.size,
              stock: existingSize ? existingSize.stock : 0
            };
          })
        };
      });
    }

    await product.save();
    res.json({ success: true, product });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A product with this name or slug already exists. Please choose a distinct name.'
      });
    }
    next(error);
  }
};

// Admin: Delete product from database
export const archiveProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const activeOrders = await Order.find({
      "items.productId": product._id,
      status: {
        $in: [
          ORDER_STATUS.PENDING,
          ORDER_STATUS.CONFIRMED,
          ORDER_STATUS.ON_THE_WAY,
          ORDER_STATUS.AT_AGENCY
        ]
      }
    }).lean();

    if (activeOrders.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete product: There are active undelivered orders referencing this product.'
      });
    }

    await Product.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    next(error);
  }
};
