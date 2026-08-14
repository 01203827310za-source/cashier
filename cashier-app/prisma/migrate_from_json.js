const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA_FILE = path.join(__dirname, '..', 'data', 'db.json');
const BACKUP = path.join(__dirname, '..', 'data', 'db.backup.json');

if(!fs.existsSync(DATA_FILE)){
  console.error('No data/db.json to migrate');
  process.exit(1);
}

console.log('Backing up', DATA_FILE, '->', BACKUP);
fs.copyFileSync(DATA_FILE, BACKUP, fs.constants.COPYFILE_EXCL);
console.log('Backup created. Running prisma generate & db push (if configured)');
try{
  execSync('npx prisma generate', { stdio: 'inherit' });
  execSync('npx prisma db push', { stdio: 'inherit' });
}catch(e){ console.warn('prisma generate/db push may have failed — ensure DATABASE_URL is set'); }

console.log('Running seed import');
try{
  execSync('node prisma/seed.js', { stdio: 'inherit' });
  console.log('Migration completed');
}catch(e){ console.error('Seed failed', e); process.exit(1); }
