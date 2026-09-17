import { Order } from '../../models/Order.js';
import { ORDER_STATUS } from '../../config/constants.js';

/**
 * Calculate financial analytics: revenue, realized profit, breakdown.
 * CRITICAL RULE: Realized profit ONLY comes from DELIVERED orders.
 * Cancelled orders do NOT contribute to revenue or realized profit.
 * Realized profit must be exactly revenue - cost (losses remain negative).
 */
export async function getFinancialAnalytics() {
  // Aggregate delivered orders for realized revenue and profit
  const deliveredAggregation = await Order.aggregate([
    { $match: { status: ORDER_STATUS.DELIVERED } },
    { $unwind: '$items' },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: { $multiply: ['$items.unitPrice', '$items.quantity'] } },
        totalCost: { $sum: { $multiply: ['$items.unitCost', '$items.quantity'] } },
        totalDeliveryFees: { $sum: '$deliveryFee' },
        unitsSold: { $sum: '$items.quantity' }
      }
    }
  ]);

  const deliveredMetrics = deliveredAggregation[0] || {
    totalRevenue: 0,
    totalCost: 0,
    totalDeliveryFees: 0,
    unitsSold: 0
  };

  // Realized profit without clamp: legitimate losses remain negative
  const realizedProfit = deliveredMetrics.totalRevenue - deliveredMetrics.totalCost;

  // Status breakdown
  const statusCounts = await Order.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$totalPrice' }
      }
    }
  ]);

  const statusMap = {
    [ORDER_STATUS.PENDING]: 0,
    [ORDER_STATUS.CONFIRMED]: 0,
    [ORDER_STATUS.ON_THE_WAY]: 0,
    [ORDER_STATUS.AT_AGENCY]: 0,
    [ORDER_STATUS.DELIVERED]: 0,
    [ORDER_STATUS.RETURNED]: 0,
    [ORDER_STATUS.CANCELLED]: 0
  };

  statusCounts.forEach(s => {
    statusMap[s._id] = s.count;
  });

  const totalOrdersCount = Object.values(statusMap).reduce((a, b) => a + b, 0);

  return {
    totalOrders: totalOrdersCount,
    statusCounts: statusMap,
    realizedRevenue: deliveredMetrics.totalRevenue,
    realizedProfit: realizedProfit,
    realizedProductCost: deliveredMetrics.totalCost,
    deliveredDeliveryFees: deliveredMetrics.totalDeliveryFees,
    unitsSold: deliveredMetrics.unitsSold
  };
}
