import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

async function processLogo() {
  const rootDir = path.resolve('..');
  const backupLogo = path.join(rootDir, 'frontend/public/logo_original.png');
  const outputLogo = path.join(rootDir, 'frontend/public/logo.png');
  const backendLogo = path.join(rootDir, 'backend/merya_logo.png');

  if (!fs.existsSync(backupLogo)) {
    throw new Error('Backup logo not found: ' + backupLogo);
  }

  const { data, info } = await sharp(backupLogo).raw().toBuffer({ resolveWithObject: true });

  // Compute tight bounding box of visible strokes
  let minX = info.width, maxX = 0, minY = info.height, maxY = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const idx = (y * info.width + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
      if (a > 20 && (r < 245 || g < 245 || b < 245)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const padding = 16;
  const cropLeft = Math.max(0, minX - padding);
  const cropTop = Math.max(0, minY - padding);
  const cropWidth = Math.min(info.width - cropLeft, (maxX - minX) + padding * 2);
  const cropHeight = Math.min(info.height - cropTop, (maxY - minY) + padding * 2);

  console.log(`Bounding box: [${minX}, ${minY}, ${maxX}, ${maxY}] => Cropped: ${cropWidth}x${cropHeight}`);

  // LUXURY WARM DARK BROWN (#553523 - chocolate / dark chestnut brown, distinctly brown, NOT black!)
  const enriched = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a > 15 && (r < 250 || g < 250 || b < 250)) {
      // Relative stroke intensity from original
      const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      
      // Target rich warm dark brown: RGB(88, 52, 34) to RGB(105, 65, 44)
      enriched[i] = Math.round(82 + lum * 24);     // Red: 82-106
      enriched[i + 1] = Math.round(48 + lum * 18); // Green: 48-66
      enriched[i + 2] = Math.round(30 + lum * 15); // Blue: 30-45
      
      // Crisp stroke opacity
      enriched[i + 3] = Math.min(255, Math.round(a * 1.35));
    } else {
      enriched[i] = 255;
      enriched[i + 1] = 255;
      enriched[i + 2] = 255;
      enriched[i + 3] = 0;
    }
  }

  await sharp(enriched, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
    .png()
    .toFile(outputLogo);

  fs.copyFileSync(outputLogo, backendLogo);
  console.log('Successfully generated rich DARK BROWN logo.png in frontend and backend!');
}

processLogo().catch(err => {
  console.error(err);
  process.exit(1);
});
