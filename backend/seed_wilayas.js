import { connectDB } from './src/config/db.js';
import { DeliverySetting } from './src/models/DeliverySetting.js';
import { ALGERIA_WILAYAS } from './src/config/constants.js';

function getDefaultWilayaRates(code) {
  if (code === 16) return { homeFee: 500, agencyFee: 350 };
  if ([9, 35, 42].includes(code)) return { homeFee: 600, agencyFee: 400 };
  if ([31, 25, 19, 15, 6, 23, 13, 27, 2, 5, 18, 21, 22, 24, 26, 29, 34, 43, 44, 46, 48].includes(code)) return { homeFee: 750, agencyFee: 450 };
  if ([3, 4, 7, 10, 12, 14, 17, 20, 28, 38, 40, 41, 45, 51].includes(code)) return { homeFee: 850, agencyFee: 500 };
  if ([8, 30, 32, 39, 47, 55, 57, 58].includes(code)) return { homeFee: 1000, agencyFee: 700 };
  return { homeFee: 1400, agencyFee: 900 };
}

async function seedRates() {
  await connectDB();

  const rates = ALGERIA_WILAYAS.map(w => {
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

  let setting = await DeliverySetting.findOne();
  if (!setting) {
    setting = new DeliverySetting();
  }

  setting.agencyDeliveryFee = 500;
  setting.homeDeliveryFee = 800;
  setting.freeDeliveryThreshold = 0;
  setting.wilayaRates = rates;

  await setting.save();
  console.log(`Successfully saved all ${setting.wilayaRates.length} wilayas in MongoDB!`);
  process.exit(0);
}

seedRates().catch(err => {
  console.error(err);
  process.exit(1);
});
