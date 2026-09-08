import { Product } from '../models/Product.js';
import { getFinancialAnalytics } from '../services/orderService.js';

export const getDashboardAnalytics = async (req, res, next) => {
  try {
    const financialData = await getFinancialAnalytics();

    // Find low-stock variants across all active products (stock <= 5)
    const lowStockProducts = await Product.aggregate([
      { $match: { isActive: true, isArchived: false } },
      { $unwind: "$colors" },
      { $unwind: "$colors.sizes" },
      { $match: { "colors.sizes.stock": { $lte: 5 } } },
      {
        $project: {
          productName: "$name",
          colorName: "$colors.colorName",
          size: "$colors.sizes.size",
          stock: "$colors.sizes.stock",
          sellingPrice: "$sellingPrice",
          image: { $arrayElemAt: ["$colors.images", 0] }
        }
      },
      { $sort: { stock: 1 } },
      { $limit: 10 }
    ]);

    // Top best seller products
    const bestSellers = await Product.find({ isActive: true, isArchived: false, isBestSeller: true })
      .select('name sellingPrice costPrice colors')
      .limit(6);

    res.json({
      success: true,
      metrics: {
        ...financialData,
        lowStockItems: lowStockProducts,
        bestSellers
      }
    });
  } catch (error) {
    next(error);
  }
};
