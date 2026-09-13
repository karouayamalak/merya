import { spawn } from 'child_process';
import fs from 'fs';

const child = spawn('node', ['--test', 'tests/productionHardeningFinalPass.test.js'], {
  cwd: process.cwd(),
  env: process.env
});

let out = '';
child.stdout.on('data', d => { out += d.toString(); });
child.stderr.on('data', d => { out += d.toString(); });

child.on('close', code => {
  fs.writeFileSync('scratch_test_output.txt', out);
  console.log('Finished with code', code);
  process.exit(code);
});
