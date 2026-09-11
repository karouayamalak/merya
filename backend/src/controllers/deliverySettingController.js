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
  // Hauts Plateaux & Intermediate Interior Wilayas + Promoted Wilayas (59-69)
  if ([3, 4, 7, 10, 12, 14, 17, 20, 28, 38, 40, 41, 45, 51, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69].includes(code)) {
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
    const settings = await DeliverySetting.findOne();
    if (!settings || !Array.isArray(settings.wilayaRates) || settings.wilayaRates.length < 69) {
      return res.status(503).json({
        success: false,
        message: 'Delivery settings configuration is incomplete or uninitialized (expected 69 Algerian wilayas). Run database seed or configure delivery settings in admin.'
      });
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

    // ── Strict wilayaRates validation ──────────────────────────────────────────
    if (wilayaRates !== undefined) {
      if (!Array.isArray(wilayaRates)) {
        return res.status(400).json({ success: false, message: 'wilayaRates must be an array.' });
      }

      if (wilayaRates.length !== 69) {
        return res.status(400).json({
          success: false,
          message: `wilayaRates must contain exactly 69 entries (one per Algerian Wilaya). Received ${wilayaRates.length}.`
        });
      }

      // Index canonical wilayas for O(1) lookup
      const canonicalByCode = new Map(ALGERIA_WILAYAS.map(w => [w.code, w]));
      const seenCodes = new Set();

      for (let i = 0; i < wilayaRates.length; i++) {
        const r = wilayaRates[i];

        // Valid canonical code 1–69 strictly as integer number
        if (typeof r.wilayaCode !== 'number' || !Number.isInteger(r.wilayaCode) || r.wilayaCode < 1 || r.wilayaCode > 69) {
          return res.status(400).json({
            success: false,
            message: `wilayaRates[${i}]: wilayaCode must be an integer between 1 and 69. Received: ${JSON.stringify(r.wilayaCode)}`
          });
        }
        const code = r.wilayaCode;

        if (!canonicalByCode.has(code)) {
          return res.status(400).json({
            success: false,
            message: `wilayaRates[${i}]: wilayaCode ${code} is not a canonical Algerian Wilaya.`
          });
        }

        // No duplicates
        if (seenCodes.has(code)) {
          return res.status(400).json({
            success: false,
            message: `wilayaRates[${i}]: Duplicate wilayaCode ${code}. Each Wilaya must appear exactly once.`
          });
        }
        seenCodes.add(code);

        const canonical = canonicalByCode.get(code);

        // If client sends names, they must strictly match canonical values
        if (r.wilayaName !== undefined) {
          if (typeof r.wilayaName !== 'string' || !r.wilayaName.trim() || r.wilayaName !== canonical.name) {
            return res.status(400).json({
              success: false,
              message: `wilayaRates[${i}]: wilayaName "${r.wilayaName}" does not match canonical name "${canonical.name}" for code ${code}.`
            });
          }
        }

        if (r.wilayaNameAr !== undefined) {
          if (typeof r.wilayaNameAr !== 'string' || !r.wilayaNameAr.trim() || r.wilayaNameAr !== canonical.nameAr) {
            return res.status(400).json({
              success: false,
              message: `wilayaRates[${i}]: wilayaNameAr "${r.wilayaNameAr}" does not match canonical Arabic name "${canonical.nameAr}" for code ${code}.`
            });
          }
        }

        // homeFee: strict finite non-negative integer (reject strings, null, NaN, decimals)
        if (typeof r.homeFee !== 'number' || !Number.isFinite(r.homeFee) || !Number.isInteger(r.homeFee) || r.homeFee < 0) {
          return res.status(400).json({
            success: false,
            message: `wilayaRates[${i}] (Wilaya ${code}): homeFee must be a finite non-negative integer in DZD. Received: ${JSON.stringify(r.homeFee)}`
          });
        }

        // agencyFee: strict finite non-negative integer (reject strings, null, NaN, decimals)
        if (typeof r.agencyFee !== 'number' || !Number.isFinite(r.agencyFee) || !Number.isInteger(r.agencyFee) || r.agencyFee < 0) {
          return res.status(400).json({
            success: false,
            message: `wilayaRates[${i}] (Wilaya ${code}): agencyFee must be a finite non-negative integer in DZD. Received: ${JSON.stringify(r.agencyFee)}`
          });
        }

        // isAvailable MUST be a strict boolean — reject strings like "false", "true", 0, 1
        if (r.isAvailable !== undefined) {
          if (typeof r.isAvailable !== 'boolean') {
            return res.status(400).json({
              success: false,
              message: `wilayaRates[${i}] (Wilaya ${code}): isAvailable must be a strict boolean (true or false). Received: ${JSON.stringify(r.isAvailable)}`
            });
          }
        }
      }

      // Ensure all 69 canonical codes are present
      for (const w of ALGERIA_WILAYAS) {
        if (!seenCodes.has(w.code)) {
          return res.status(400).json({
            success: false,
            message: `wilayaRates is missing an entry for Wilaya ${w.code} (${w.name}).`
          });
        }
      }
    }
    // ── End validation ──────────────────────────────────────────────────────────

    let settings = await DeliverySetting.findOne();
    if (!settings) {
      settings = new DeliverySetting();
    }

    if (agencyDeliveryFee !== undefined) {
      if (typeof agencyDeliveryFee !== 'number' || !Number.isFinite(agencyDeliveryFee) || !Number.isInteger(agencyDeliveryFee) || agencyDeliveryFee < 0) {
        return res.status(400).json({ success: false, message: 'agencyDeliveryFee must be a finite non-negative integer in DZD.' });
      }
      settings.agencyDeliveryFee = agencyDeliveryFee;
    }
    if (homeDeliveryFee !== undefined) {
      if (typeof homeDeliveryFee !== 'number' || !Number.isFinite(homeDeliveryFee) || !Number.isInteger(homeDeliveryFee) || homeDeliveryFee < 0) {
        return res.status(400).json({ success: false, message: 'homeDeliveryFee must be a finite non-negative integer in DZD.' });
      }
      settings.homeDeliveryFee = homeDeliveryFee;
    }
    if (freeDeliveryThreshold !== undefined) {
      if (typeof freeDeliveryThreshold !== 'number' || !Number.isFinite(freeDeliveryThreshold) || !Number.isInteger(freeDeliveryThreshold) || freeDeliveryThreshold < 0) {
        return res.status(400).json({ success: false, message: 'freeDeliveryThreshold must be a finite non-negative integer in DZD.' });
      }
      settings.freeDeliveryThreshold = freeDeliveryThreshold;
    }

    if (Array.isArray(wilayaRates)) {
      const canonicalByCode = new Map(ALGERIA_WILAYAS.map(w => [w.code, w]));
      // Server DERIVES canonical wilayaName and wilayaNameAr unconditionally
      settings.wilayaRates = wilayaRates.map(r => {
        const canonical = canonicalByCode.get(r.wilayaCode);
        return {
          wilayaCode: r.wilayaCode,
          wilayaName: canonical.name,
          wilayaNameAr: canonical.nameAr,
          homeFee: r.homeFee,
          agencyFee: r.agencyFee,
          isAvailable: r.isAvailable === false ? false : true
        };
      }).sort((a, b) => a.wilayaCode - b.wilayaCode);
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
