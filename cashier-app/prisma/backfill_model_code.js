/* ============================================================
   سكريبت لمرة واحدة: يملأ كود الموديل (modelCode) لأي منتج قديم
   من غير كود، قبل ما نخلي العمود إلزامي (NOT NULL) في السكيما.

   الاستخدام (بعد npm run db:push اللي بيضيف العمود كـ nullable):
     node prisma/backfill_model_code.js
   أو:
     npm run db:backfill-model-code
   ============================================================ */
const { PrismaClient } = require('@prisma/client');
const { deriveModelCode } = require('../src/db');
const prisma = new PrismaClient();

async function main(){
  const products = await prisma.product.findMany({ orderBy: { id: 'asc' } });

  const usedCodes = new Set();
  products.forEach(function(p){
    const mc = (p.modelCode || "").trim();
    if (mc) usedCodes.add(mc.toLowerCase());
  });

  const missing = products.filter(function(p){ return !(p.modelCode || "").trim(); });
  if (!missing.length) {
    console.log('كل المنتجات (' + products.length + ') عندها كود موديل بالفعل — مفيش حاجة نعملها.');
  } else {
    console.log('لقيت ' + missing.length + ' منتج من غير كود موديل من إجمالي ' + products.length + '. جاري التعبئة...');
    for (const p of missing) {
      const source = (p.sku && p.sku.trim() && !usedCodes.has(p.sku.trim().toLowerCase())) ? 'sku' : 'generated';
      const modelCode = deriveModelCode(p, usedCodes);
      await prisma.product.update({ where: { id: p.id }, data: { modelCode } });
      console.log('  ' + p.id + '  (' + (p.name || '') + ')  →  ' + modelCode + '  [' + source + ']');
    }
    console.log('تمت تعبئة ' + missing.length + ' منتج.');
  }

  const stillMissing = await prisma.product.count({ where: { modelCode: null } });
  if (stillMissing === 0) {
    console.log('✅ 0 منتج من غير كود موديل — آمن دلوقتي إنك تخلي modelCode إلزامي (String @unique بدل String? @unique) في prisma/schema.prisma وتشغّل npm run db:push تاني.');
  } else {
    console.warn('⚠️ لسه في ' + stillMissing + ' منتج من غير كود موديل — راجع اللوج فوق قبل ما تخلي العمود إلزامي.');
  }
}

main()
  .catch(function(e){ console.error('فشل السكريبت:', e); process.exit(1); })
  .finally(async function(){ await prisma.$disconnect(); });
