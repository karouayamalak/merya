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

    // ── Strict wilayaRates validation ──────────────────────────────────────────
    if (wilayaRates !== undefined) {
      if (!Array.isArray(wilayaRates)) {
        return res.status(400).json({ success: false, message: 'wilayaRates must be an array.' });
      }

      if (wilayaRates.length !== 58) {
        return res.status(400).json({
          success: false,
          message: `wilayaRates must contain exactly 58 entries (one per Algerian Wilaya). Received ${wilayaRates.length}.`
        });
      }

      // Index canonical wilayas for O(1) lookup
      const canonicalByCode = new Map(ALGERIA_WILAYAS.map(w => [w.code, w]));
      const seenCodes = new Set();

      for (let i = 0; i < wilayaRates.length; i++) {
        const r = wilayaRates[i];
        const code = Number(r.wilayaCode);

        // Valid canonical code 1–58
        if (!Number.isInteger(code) || code < 1 || code > 58) {
          return res.status(400).json({
            success: false,
            message: `wilayaRates[${i}]: wilayaCode ${r.wilayaCode} is not a valid Algerian Wilaya code (must be integer 1–58).`
          });
        }
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

        // wilayaName must match canonical English name
        if (r.wilayaName !== undefined && r.wilayaName !== '') {
          if (r.wilayaName !== canonical.name) {
            return res.status(400).json({
              success: false,
              message: `wilayaRates[${i}]: wilayaName "${r.wilayaName}" does not match canonical name "${canonical.name}" for code ${code}.`
            });
          }
        }

        // wilayaNameAr must match canonical Arabic name if provided
        if (r.wilayaNameAr !== undefined && r.wilayaNameAr !== '') {
          if (r.wilayaNameAr !== canonical.nameAr) {
            return res.status(400).json({
              success: false,
              message: `wilayaRates[${i}]: wilayaNameAr "${r.wilayaNameAr}" does not match canonical Arabic name "${canonical.nameAr}" for code ${code}.`
            });
          }
        }

        // homeFee: finite non-negative number
        const homeFee = Number(r.homeFee);
        if (!Number.isFinite(homeFee) || homeFee < 0) {
          return res.status(400).json({
            success: false,
            message: `wilayaRates[${i}] (Wilaya ${code}): homeFee must be a finite non-negative number. Received: ${r.homeFee}`
          });
        }

        // agencyFee: finite non-negative number
        const agencyFee = Number(r.agencyFee);
        if (!Number.isFinite(agencyFee) || agencyFee < 0) {
          return res.status(400).json({
            success: false,
            message: `wilayaRates[${i}] (Wilaya ${code}): agencyFee must be a finite non-negative number. Received: ${r.agencyFee}`
          });
        }

        // isAvailable MUST be a strict boolean — reject strings like "false", "true", 0, 1
        if (r.isAvailable !== undefined) {
          if (r.isAvailable !== true && r.isAvailable !== false) {
            return res.status(400).json({
              success: false,
              message: `wilayaRates[${i}] (Wilaya ${code}): isAvailable must be a strict boolean (true or false). Received: ${JSON.stringify(r.isAvailable)}`
            });
          }
        }
      }

      // Ensure all 58 canonical codes are present
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
      const v = Number(agencyDeliveryFee);
      if (!Number.isFinite(v) || v < 0) {
        return res.status(400).json({ success: false, message: 'agencyDeliveryFee must be a finite non-negative number.' });
      }
      settings.agencyDeliveryFee = v;
    }
    if (homeDeliveryFee !== undefined) {
      const v = Number(homeDeliveryFee);
      if (!Number.isFinite(v) || v < 0) {
        return res.status(400).json({ success: false, message: 'homeDeliveryFee must be a finite non-negative number.' });
      }
      settings.homeDeliveryFee = v;
    }
    if (freeDeliveryThreshold !== undefined) {
      const v = Number(freeDeliveryThreshold);
      if (!Number.isFinite(v) || v < 0) {
        return res.status(400).json({ success: false, message: 'freeDeliveryThreshold must be a finite non-negative number.' });
      }
      settings.freeDeliveryThreshold = v;
    }

    if (Array.isArray(wilayaRates)) {
      // Safe to map — already validated above
      settings.wilayaRates = wilayaRates.map(r => ({
        wilayaCode: Number(r.wilayaCode),
        wilayaName: r.wilayaName,
        wilayaNameAr: r.wilayaNameAr || '',
        homeFee: Number(r.homeFee),
        agencyFee: Number(r.agencyFee),
        isAvailable: r.isAvailable // strict boolean, validated above
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
