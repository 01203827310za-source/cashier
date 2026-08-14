/* ============================================================
   سكريبت لمرة واحدة: يملأ paid/remaining/paymentStatus لأي فاتورة
   شراء قديمة (خصوصاً فواتير البضاعة) كانت null لأن الواجهة القديمة
   ما كانتش بترسل paid عند الإنشاء — null هنا كانت دايمًا تعني
   "لسه ملحقش يتسجل عليها دفعة"، فالتعبئة هنا آمنة ومش بتخترع بيانات
   جديدة، بس بتخليها صريحة/قابلة للاستعلام (وبتفتح زرار "إضافة دفعة"
   في الواجهة اللي كان مختفي بسبب null > 0 === false).

   الاستخدام:
     node prisma/backfill_purchase_payment_status.js
   أو:
     npm run db:backfill-purchase-status
   ============================================================ */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main(){
  const purchases = await prisma.purchase.findMany({ where: { paid: null }, orderBy: { id: 'asc' } });

  if (!purchases.length) {
    console.log('كل فواتير الشراء عندها paid محدد بالفعل — مفيش حاجة نعملها.');
  } else {
    console.log('لقيت ' + purchases.length + ' فاتورة شراء بدون paid محدد. جاري التعبئة (paid=0, unpaid)...');
    for (const p of purchases) {
      const total = p.total || 0;
      await prisma.purchase.update({
        where: { id: p.id },
        data: { paid: 0, remaining: total, paymentStatus: 'unpaid' }
      });
      console.log('  ' + p.id + '  (' + (p.number || '') + ')  →  paid=0, remaining=' + total + ', paymentStatus=unpaid');
    }
    console.log('تمت تعبئة ' + purchases.length + ' فاتورة.');
  }

  const stillMissing = await prisma.purchase.count({ where: { paid: null } });
  console.log(stillMissing === 0
    ? '✅ 0 فاتورة شراء بدون حالة دفع — زرار "إضافة دفعة" وشارة الحالة هيشتغلوا صح دلوقتي لكل الفواتير.'
    : '⚠️ لسه في ' + stillMissing + ' فاتورة بدون حالة دفع — راجع اللوج فوق.');
}

main()
  .catch(function(e){ console.error('فشل السكريبت:', e); process.exit(1); })
  .finally(async function(){ await prisma.$disconnect(); });
