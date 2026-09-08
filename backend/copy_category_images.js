import fs from 'fs';
import path from 'path';

const srcDir = 'C:\\Users\\ayaka\\.gemini\\antigravity-ide\\brain\\08c7c655-0794-4fc0-8ae5-f68d29bd1729';
const uploadsDir = path.resolve('backend/uploads');
const publicUploadsDir = path.resolve('frontend/public/uploads');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(publicUploadsDir)) fs.mkdirSync(publicUploadsDir, { recursive: true });

const files = [
  { src: path.join(srcDir, '.user_uploaded/media_1788890878426.jpg'), dest: 'merya_top_white_1.jpg' },
  { src: path.join(srcDir, '.user_uploaded/media_1788890885234.jpg'), dest: 'merya_dress_cream_1.jpg' },
  { src: path.join(srcDir, 'merya_skirt_beige_1788891164846.jpg'), dest: 'merya_skirt_beige.jpg' },
  { src: path.join(srcDir, 'merya_ensemble_set_1788891186821.jpg'), dest: 'merya_ensemble_set.jpg' }
];

for (const f of files) {
  if (fs.existsSync(f.src)) {
    fs.copyFileSync(f.src, path.join(uploadsDir, f.dest));
    fs.copyFileSync(f.src, path.join(publicUploadsDir, f.dest));
    console.log(`Copied ${f.dest} successfully.`);
  } else {
    console.error(`File missing: ${f.src}`);
  }
}

console.log('All category images synced to backend and frontend uploads.');
