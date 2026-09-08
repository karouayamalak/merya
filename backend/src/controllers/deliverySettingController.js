import { DeliverySetting } from '../models/DeliverySetting.js';
import { ALGERIA_WILAYAS } from '../config/constants.js';

// Helper to determine realistic default Algerian shipping prices based on Wilaya
function getDefaultWilayaRates(code) {
  // Algiers (16)
  if (code === 16) {
    return { homeFee: 500, agencyFee: 350 };
  }
  // Algiers suburbs / nearby (09 Blida, 35 Boumerdes, 42 Tipaza)
  if ([9, 35, 42].includes(code)) {
    return { homeFee: 600, agencyFee: 400 };
  }
  // Major Northern/Coastal Wilayas (31 Oran, 25 Constantine, 19 Setif, 15 Tizi Ouzou, 06 Bejaia, 23 Annaba, 13 Tlemcen, 27 Mostaganem, 02 Chlef)
  if ([31, 25, 19, 15, 6, 23, 13, 27, 2, 5, 18, 21, 22, 24, 26, 29, 34, 43, 44, 46, 48].includes(code)) {
    return { homeFee: 750, agencyFee: 450 };
  }
  // Hauts Plateaux & Intermediate Interior Wilayas
  if ([3, 4, 7, 10, 12, 14, 17, 20, 28, 38, 40, 41, 45, 51].includes(code)) {
    return { homeFee: 850, agencyFee: 500 };
  }
  // Near South Wilayas
  if ([8, 30, 32, 39, 47, 55, 57, 58].includes(code)) {
    return { homeFee: 1000, agencyFee: 700 };
  }
  // Far South Wilayas (11 Tamanrasset, 33 Illizi, 37 Tindouf, 49 Timimoun, 50 Bordj Badji Mokhtar, 52 Béni Abbès, 53 In Salah, 54 In Guezzam, 56 Djanet, 01 Adrar)
  return { homeFee: 1400, agencyFee: 900 };
}

export const getDeliverySettings = async (req, res, next) => {
  try {
    let settings = await DeliverySetting.findOne();
    if (!settings) {
      settings = new DeliverySetting({
        agencyDeliveryFee: 500,
        homeDeliveryFee: 800,
        freeDeliveryThreshold: 0,
        wilayaRates: []
      });
    }

    // Ensure all 58 Wilayas are represented in wilayaRates
    let modified = false;
    const existingCodes = new Set((settings.wilayaRates || []).map(r => r.wilayaCode));

    for (const w of ALGERIA_WILAYAS) {
      if (!existingCodes.has(w.code)) {
        const defaults = getDefaultWilayaRates(w.code);
        settings.wilayaRates.push({
          wilayaCode: w.code,
          wilayaName: w.name,
          wilayaNameAr: w.nameAr,
          homeFee: defaults.homeFee,
          agencyFee: defaults.agencyFee,
          isAvailable: true
        });
        modified = true;
      }
    }

    // Keep sorted by code 1-58
    settings.wilayaRates.sort((a, b) => a.wilayaCode - b.wilayaCode);

    if (modified || settings.isNew) {
      await settings.save();
    }

    res.json({
      success: true,
      settings: {
        agencyDeliveryFee: settings.agencyDeliveryFee,
        homeDeliveryFee: settings.homeDeliveryFee,
        freeDeliveryThreshold: settings.freeDeliveryThreshold,
        wilayaRates: settings.wilayaRates
      },
      wilayas: settings.wilayaRates
    });
  } catch (error) {
    next(error);
  }
};

export const updateDeliverySettings = async (req, res, next) => {
  try {
    const { agencyDeliveryFee, homeDeliveryFee, freeDeliveryThreshold, wilayaRates } = req.body;

    let settings = await DeliverySetting.findOne();
    if (!settings) {
      settings = new DeliverySetting();
    }

    if (agencyDeliveryFee !== undefined) settings.agencyDeliveryFee = Number(agencyDeliveryFee);
    if (homeDeliveryFee !== undefined) settings.homeDeliveryFee = Number(homeDeliveryFee);
    if (freeDeliveryThreshold !== undefined) settings.freeDeliveryThreshold = Number(freeDeliveryThreshold);

    if (Array.isArray(wilayaRates)) {
      settings.wilayaRates = wilayaRates.map(r => ({
        wilayaCode: Number(r.wilayaCode),
        wilayaName: r.wilayaName || '',
        wilayaNameAr: r.wilayaNameAr || '',
        homeFee: Math.max(0, Number(r.homeFee) || 0),
        agencyFee: Math.max(0, Number(r.agencyFee) || 0),
        isAvailable: r.isAvailable !== undefined ? Boolean(r.isAvailable) : true
      })).sort((a, b) => a.wilayaCode - b.wilayaCode);
    }

    settings.updatedBy = req.admin?._id;
    await settings.save();

    res.json({
      success: true,
      settings: {
        agencyDeliveryFee: settings.agencyDeliveryFee,
        homeDeliveryFee: settings.homeDeliveryFee,
        freeDeliveryThreshold: settings.freeDeliveryThreshold,
        wilayaRates: settings.wilayaRates
      }
    });
  } catch (error) {
    next(error);
  }
};
