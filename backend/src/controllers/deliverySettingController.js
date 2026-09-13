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
    const settings = await DeliverySetting.getSingleton();
    if (!settings || !Array.isArray(settings.wilayaRates) || settings.wilayaRates.length !== 58) {
      return res.status(503).json({
        success: false,
        message: 'Delivery settings configuration is incomplete, stale, or uninitialized (expected exactly 58 Algerian wilayas). Run database seed or configure delivery settings in admin.'
      });
    }

    // Index canonical wilayas for strict O(1) validation
    const canonicalByCode = new Map(ALGERIA_WILAYAS.map(w => [w.code, w]));
    const seenCodes = new Set();

    for (let i = 0; i < settings.wilayaRates.length; i++) {
      const r = settings.wilayaRates[i];
      if (!r || typeof r !== 'object') {
        return res.status(503).json({
          success: false,
          message: `Delivery configuration corrupted: invalid entry at index ${i}.`
        });
      }

      // Must be an integer number between 1 and 58
      const code = r.wilayaCode;
      if (typeof code !== 'number' || !Number.isInteger(code) || code < 1 || code > 58) {
        return res.status(503).json({
          success: false,
          message: `Delivery configuration corrupted: invalid wilayaCode ${code} (expected integer 1–58).`
        });
      }

      // No duplicates allowed
      if (seenCodes.has(code)) {
        return res.status(503).json({
          success: false,
          message: `Delivery configuration corrupted: duplicate wilayaCode ${code}. Each Wilaya must be unique.`
        });
      }
      seenCodes.add(code);

      const canonical = canonicalByCode.get(code);
      if (!canonical || typeof r.wilayaName !== 'string' || r.wilayaName.trim() !== canonical.name) {
        return res.status(503).json({
          success: false,
          message: `Delivery configuration corrupted: wilaya ${code} name does not match canonical name "${canonical?.name}".`
        });
      }

      // Strict non-negative integer fee validation
      if (typeof r.homeFee !== 'number' || !Number.isFinite(r.homeFee) || !Number.isInteger(r.homeFee) || r.homeFee < 0) {
        return res.status(503).json({
          success: false,
          message: `Delivery configuration corrupted: homeFee for wilaya ${code} must be a non-negative integer.`
        });
      }

      if (typeof r.agencyFee !== 'number' || !Number.isFinite(r.agencyFee) || !Number.isInteger(r.agencyFee) || r.agencyFee < 0) {
        return res.status(503).json({
          success: false,
          message: `Delivery configuration corrupted: agencyFee for wilaya ${code} must be a non-negative integer.`
        });
      }

      if (r.isAvailable !== undefined && typeof r.isAvailable !== 'boolean') {
        return res.status(503).json({
          success: false,
          message: `Delivery configuration corrupted: isAvailable for wilaya ${code} must be a boolean.`
        });
      }
    }

    // Ensure all codes 1 through 58 are present
    for (let c = 1; c <= 58; c++) {
      if (!seenCodes.has(c)) {
        return res.status(503).json({
          success: false,
          message: `Delivery configuration corrupted: missing canonical Wilaya ${c}.`
        });
      }
    }

    const enrichedRates = settings.wilayaRates.map(r => {
      const canonical = canonicalByCode.get(r.wilayaCode);
      const rObj = r.toObject ? r.toObject() : { ...r };
      return {
        ...rObj,
        wilayaName: canonical ? canonical.name : r.wilayaName,
        wilayaNameAr: canonical ? canonical.nameAr : r.wilayaNameAr,
        wilayaNameFr: canonical?.nameFr || canonical?.name || r.wilayaNameFr || r.wilayaName,
        wilayaNameEn: canonical?.nameEn || r.wilayaNameEn || r.wilayaName
      };
    });

    res.json({
      success: true,
      settings: {
        freeDeliveryThreshold: (typeof settings.freeDeliveryThreshold === 'number' && Number.isFinite(settings.freeDeliveryThreshold) && settings.freeDeliveryThreshold >= 0)
          ? settings.freeDeliveryThreshold
          : 0,
        wilayaRates: enrichedRates,
        __v: settings.__v,
        version: settings.__v
      },
      wilayas: enrichedRates
    });
  } catch (error) {
    next(error);
  }
};

export const updateDeliverySettings = async (req, res, next) => {
  try {
    // Reject legacy global pricing fields with explicit 400 Bad Request
    if (req.body.agencyDeliveryFee !== undefined || req.body.homeDeliveryFee !== undefined) {
      return res.status(400).json({
        success: false,
        message: 'Legacy global delivery fee fields (agencyDeliveryFee, homeDeliveryFee) are no longer supported. Authoritative delivery pricing is strictly per-Wilaya in wilayaRates[].'
      });
    }

    const { freeDeliveryThreshold, wilayaRates } = req.body;

    // Strict freeDeliveryThreshold validation
    if (freeDeliveryThreshold !== undefined) {
      if (typeof freeDeliveryThreshold !== 'number' || !Number.isFinite(freeDeliveryThreshold) || !Number.isInteger(freeDeliveryThreshold) || freeDeliveryThreshold < 0) {
        return res.status(400).json({ success: false, message: 'freeDeliveryThreshold must be a finite non-negative integer in DZD.' });
      }
    }

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

        // Valid canonical code 1–58 strictly as integer number
        if (typeof r.wilayaCode !== 'number' || !Number.isInteger(r.wilayaCode) || r.wilayaCode < 1 || r.wilayaCode > 58) {
          return res.status(400).json({
            success: false,
            message: `wilayaRates[${i}]: wilayaCode must be an integer between 1 and 58. Received: ${JSON.stringify(r.wilayaCode)}`
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

    let settings = await DeliverySetting.getSingleton();
    const canonicalByCode = new Map(ALGERIA_WILAYAS.map(w => [w.code, w]));

    if (!settings) {
      const canonicalRates = Array.isArray(wilayaRates) ? wilayaRates.map(r => {
        const canonical = canonicalByCode.get(r.wilayaCode);
        return {
          wilayaCode: r.wilayaCode,
          wilayaName: canonical.name,
          wilayaNameAr: canonical.nameAr,
          wilayaNameFr: canonical.nameFr || canonical.name,
          wilayaNameEn: canonical.nameEn || canonical.name,
          homeFee: r.homeFee,
          agencyFee: r.agencyFee,
          isAvailable: r.isAvailable === false ? false : true
        };
      }).sort((a, b) => a.wilayaCode - b.wilayaCode) : ALGERIA_WILAYAS.map(w => {
        const d = getDefaultWilayaRates(w.code);
        return {
          wilayaCode: w.code,
          wilayaName: w.name,
          wilayaNameAr: w.nameAr,
          wilayaNameFr: w.nameFr || w.name,
          wilayaNameEn: w.nameEn || w.name,
          homeFee: d.homeFee,
          agencyFee: d.agencyFee,
          isAvailable: true
        };
      });

      settings = await DeliverySetting.create({
        singletonKey: 'default',
        freeDeliveryThreshold: freeDeliveryThreshold !== undefined ? freeDeliveryThreshold : 0,
        wilayaRates: canonicalRates,
        updatedBy: req.admin?._id
      });

      return res.json({
        success: true,
        settings: {
          freeDeliveryThreshold: settings.freeDeliveryThreshold,
          wilayaRates: settings.wilayaRates,
          __v: settings.__v,
          version: settings.__v
        }
      });
    }

    // ── Optimistic Concurrency Control (CAS on __v) ───────────────────────────
    const expectedVersion = req.body.expectedVersion !== undefined
      ? Number(req.body.expectedVersion)
      : (req.body.__v !== undefined
          ? Number(req.body.__v)
          : (req.body.version !== undefined ? Number(req.body.version) : settings.__v));

    const updateFields = {
      updatedBy: req.admin?._id
    };

    if (freeDeliveryThreshold !== undefined) {
      updateFields.freeDeliveryThreshold = freeDeliveryThreshold;
    }

    if (Array.isArray(wilayaRates)) {
      updateFields.wilayaRates = wilayaRates.map(r => {
        const canonical = canonicalByCode.get(r.wilayaCode);
        return {
          wilayaCode: r.wilayaCode,
          wilayaName: canonical.name,
          wilayaNameAr: canonical.nameAr,
          wilayaNameFr: canonical.nameFr || canonical.name,
          wilayaNameEn: canonical.nameEn || canonical.name,
          homeFee: r.homeFee,
          agencyFee: r.agencyFee,
          isAvailable: r.isAvailable === false ? false : true
        };
      }).sort((a, b) => a.wilayaCode - b.wilayaCode);
    }

    const updatedSettings = await DeliverySetting.findOneAndUpdate(
      { _id: settings._id, __v: expectedVersion },
      {
        $set: updateFields,
        $inc: { __v: 1 }
      },
      { new: true, runValidators: true }
    );

    if (!updatedSettings) {
      return res.status(409).json({
        success: false,
        code: 'CONCURRENT_CONFLICT',
        message: 'CONCURRENT_CONFLICT: Delivery settings were modified concurrently by another administrator. Please refresh and retry.'
      });
    }

    res.json({
      success: true,
      settings: {
        freeDeliveryThreshold: updatedSettings.freeDeliveryThreshold,
        wilayaRates: updatedSettings.wilayaRates,
        __v: updatedSettings.__v,
        version: updatedSettings.__v
      }
    });
  } catch (error) {
    next(error);
  }
};
