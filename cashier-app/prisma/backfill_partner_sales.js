/* ============================================================
   سكريبت لمرة واحدة: يسجّل في سجل حسابات الشركاء (PartnerTransaction)
   حركة دخل واحدة لصالح "مؤمن" عن كل فاتورة بيع (Sale) قديمة موجودة
   بالفعل، قبل ما يتفعّل نظام الشركاء.

   ليه آمن نعمل ده لفواتير البيع تحديدًا (وليس المصاريف/الإيرادات
   الأخرى/دفعات الموردين): كل فاتورة بيع في هذا النظام هي بيع كاش
   من نقطة البيع (POS) بلا استثناء — القاعدة "كل بيع = مؤمن" مش
   محتملة الخطأ ولا بتخترع ملكية تاريخية، هي انعكاس مباشر لقاعدة
   العمل الوحيدة الموجودة أصلاً. أما المصاريف/الإيرادات الأخرى/دفعات
   الموردين القديمة فمفيش طريقة آمنة نعرف مين دفعها وقتها، فبتفضل
   خارج السجل الجديد لحد ما يتسجل عليها شريك يدويًا من دلوقتي فصاعدًا.

   السكريبت idempotent — تشغيله أكتر من مرة مش هيكرر القيود
   (بيتخطى أي فاتورة بيع ليها قيد SALE مسجل بالفعل).

   الاستخدام:
     node prisma/backfill_partner_sales.js
   أو:
     npm run db:backfill-partner-sales
   ============================================================ */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

async function main(){
  const sales = await prisma.sale.findMany({ orderBy: { id: 'asc' } });
  const existing = await prisma.partnerTransaction.findMany({ where: { referenceType: 'sale' }, select: { referenceId: true } });
  const already = new Set(existing.map(function(e){ return e.referenceId; }));

  const missing = sales.filter(function(s){ return !already.has(s.id) && (s.total || 0) > 0; });

  if (!missing.length) {
    console.log('كل فواتير البيع (' + sales.length + ') ليها بالفعل قيد في سجل مؤمن — مفيش حاجة نعملها.');
  } else {
    console.log('لقيت ' + missing.length + ' فاتورة بيع من غير قيد في سجل الشركاء من إجمالي ' + sales.length + '. جاري التسجيل لصالح مؤمن...');
    for (const s of missing) {
      await prisma.partnerTransaction.create({
        data: {
          id: uid(), partner: 'moamen', type: 'SALE', direction: 'in', amount: s.total,
          referenceType: 'sale', referenceId: s.id, date: s.date || new Date(),
          userId: s.userId || null, notes: 'ترحيل تاريخي — فاتورة ' + (s.number || s.id)
        }
      });
      console.log('  ' + s.id + '  (' + (s.number || '') + ')  →  مؤمن +' + s.total);
    }
    console.log('تم ترحيل ' + missing.length + ' فاتورة بيع لسجل حساب مؤمن.');
  }
}

main()
  .catch(function(e){ console.error('فشل السكريبت:', e); process.exit(1); })
  .finally(async function(){ await prisma.$disconnect(); });
