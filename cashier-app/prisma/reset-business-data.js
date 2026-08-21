/*
 * تصفير بيانات العمل التجريبية — سكريبت لمرة واحدة
 * ============================================================
 * الغرض: حذف كل بيانات العمل/الاختبار (مبيعات، مشتريات، أوردرات، ديون،
 * مصاريف، دفتر الشركاء، المخزون...) من قاعدة بيانات Railway الإنتاجية،
 * بدون المساس بالـ schema أو المستخدمين أو الصلاحيات أو إعدادات النظام.
 *
 * لا يحذف قاعدة البيانات ولا الجداول نفسها — فقط الصفوف بداخلها، بترتيب
 * آمن حسب علاقات المفاتيح الأجنبية (الأبناء قبل الآباء)، بنفس الترتيب
 * المستخدم فعلاً في src/db.js (replaceStateInDB) لمسح/استرجاع الحالة.
 *
 * الاستخدام:
 *   node prisma/reset-business-data.js
 *     → وضع معاينة فقط (Dry Run): يعرض عدد السجلات الحالية بدون حذف أي شيء.
 *
 *   node prisma/reset-business-data.js --confirm
 *     → التنفيذ الفعلي داخل معاملة واحدة (transaction).
 *
 * أعلام اختيارية (مع --confirm):
 *   --include-customers-suppliers   احذف كمان سجلات العملاء والموردين (بيانات تجريبية:
 *                                    "عميل تجريبي"/"مورد تجريبي" من data/db.json الأصلي).
 *                                    افتراضيًا محفوظة، لأن التعليمات ذكرت فقط "بيانات
 *                                    المعاملات" الخاصة بهم لا السجلات نفسها.
 *   --include-categories            احذف كمان فئات المنتجات وفئات المصاريف (قوائم
 *                                    إعداد قابلة لإعادة الاستخدام — محفوظة افتراضيًا).
 *   --keep-counters                 سيب عدادات الفواتير/الأوردرات/المرتجعات/أوامر
 *                                    الطباعة زي ما هي بدل إرجاعها لـ 1001.
 *   --i-have-a-backup                تأكيد إنك أخدت نسخة احتياطية يدويًا، مطلوب فقط
 *                                    لو السكريبت مقدرش يعمل نسخة تلقائية بـ pg_dump.
 *
 * الأمان:
 *   - مفيش أي مكان في السكريبت ده بيطبع DATABASE_URL أو اليوزر/الباسورد —
 *     بس اسم السيرفر (host) واسم القاعدة (database) للتأكد البصري إنك بتستهدف
 *     القاعدة الصح، مستخرجين بأمان عن طريق تحليل الرابط (URL parsing).
 *   - وضع المعاينة هو الافتراضي — لازم --confirm صريح عشان يحذف أي حاجة فعلاً.
 *   - قبل الحذف الفعلي، بيحاول ياخد نسخة احتياطية محلية بـ pg_dump تلقائيًا؛
 *     لو pg_dump مش موجود أو فشل، بيوقف ويطلب --i-have-a-backup صراحة.
 *   - كل عمليات الحذف جوه معاملة واحدة (prisma.$transaction) — لو أي خطوة فشلت،
 *     كل حاجة بترجع زي ما كانت (rollback كامل).
 *   - بعد التنفيذ، بيتحقق فعليًا من قاعدة البيانات (مش مجرد افتراض) إن كل جدول
 *     اتصفر، وإن المستخدمين/الأدمن/الصلاحيات/الإعدادات لسه موجودين.
 *
 * محفوظ دايمًا (مش بيتلمس خالص):
 *   User, UserPermission, Setting, ShippingCompany, ShippingPrice
 *   (و Customer/Supplier/Category/ExpenseCategory إلا لو استخدمت الأعلام فوق)
 *
 * "مؤمن"/"عبدو" مش مخزّنين كسجلات مستقلة في القاعدة أصلاً — هما مجرد قيمة
 * نصية ("moamen"/"abdo") جوه أعمدة partner في PartnerTransaction/Expense/
 * OtherIncome/Debt/... وجوه كود الواجهة (PARTNERS array). مفيش "سجل شريك"
 * يتحذف أو يتحفظ — رصيدهم بيتحسب دايمًا SUM(IN)-SUM(OUT) من PartnerTransaction،
 * فبمجرد ما الجدول ده يتصفر بيبقى الرصيد صفر تلقائيًا من غير أي تعديل يدوي.
 */
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const EXECUTE = args.includes("--confirm");
const INCLUDE_CONTACTS = args.includes("--include-customers-suppliers");
const INCLUDE_CATEGORIES = args.includes("--include-categories");
const KEEP_COUNTERS = args.includes("--keep-counters");
const HAS_BACKUP_FLAG = args.includes("--i-have-a-backup");

// ترتيب الحذف الآمن: الأبناء قبل الآباء. الجداول اللي معندهاش onDelete:Cascade
// من ناحية الأب في schema.prisma (SaleReturn→Sale، PurchasePayment→Purchase،
// DebtPayment→Debt، OrderCollection/OrderExchange→Order) لازم تتحذف صراحة قبل
// أبوها. نفس الترتيب المستخدم فعلاً في src/db.js (replaceStateInDB).
const DELETION_PLAN = [
  { model: "saleReturnItem", label: "أصناف الاسترجاع/الاستبدال" },
  { model: "saleReturn", label: "عمليات الاسترجاع/الاستبدال" },
  { model: "saleItem", label: "أصناف فواتير البيع" },
  { model: "sale", label: "فواتير البيع (POS)" },
  { model: "purchasePayment", label: "دفعات فواتير الشراء" },
  { model: "purchaseItem", label: "أصناف فواتير الشراء" },
  { model: "purchase", label: "فواتير الشراء" },
  { model: "debtPayment", label: "دفعات الديون" },
  { model: "debt", label: "الديون" },
  { model: "orderExchangeItem", label: "أصناف استبدال الأوردرات" },
  { model: "orderExchange", label: "استبدالات الأوردرات" },
  { model: "orderCollection", label: "تحصيلات/عرابين الأوردرات" },
  { model: "orderItem", label: "أصناف الأوردرات" },
  { model: "order", label: "الأوردرات" },
  { model: "printingOrder", label: "أوامر الطباعة" },
  { model: "partnerTransaction", label: "حركات دفتر الشركاء" },
  { model: "expense", label: "المصاريف" },
  { model: "otherIncome", label: "الإيرادات الأخرى" },
  { model: "paymentIn", label: "دفعات واردة (عملاء)" },
  { model: "paymentOut", label: "دفعات صادرة (موردين)" },
  { model: "cashClosing", label: "إقفالات الخزنة" },
  { model: "transfer", label: "تحويلات الخزنة" },
  { model: "auditLog", label: "سجل الحركات القديم" },
  { model: "productVariant", label: "متغيرات المنتجات (مقاس/لون)" },
  { model: "product", label: "المنتجات" },
  { model: "rawState", label: "نسخة بيانات البذر الأصلية (seed snapshot)" }
];
if(INCLUDE_CONTACTS){
  DELETION_PLAN.push({ model: "customer", label: "العملاء" });
  DELETION_PLAN.push({ model: "supplier", label: "الموردين" });
}
if(INCLUDE_CATEGORIES){
  DELETION_PLAN.push({ model: "category", label: "فئات المنتجات" });
  DELETION_PLAN.push({ model: "expenseCategory", label: "فئات المصاريف" });
}

const PRESERVED_MODELS = ["user", "userPermission", "setting", "shippingCompany", "shippingPrice"];
if(!INCLUDE_CONTACTS) PRESERVED_MODELS.push("customer", "supplier");
if(!INCLUDE_CATEGORIES) PRESERVED_MODELS.push("category", "expenseCategory");

function safeTargetInfo(){
  try{
    const u = new URL(process.env.DATABASE_URL || "");
    return { host: u.hostname || "(unknown)", database: (u.pathname || "").replace(/^\//, "") || "(unknown)" };
  }catch(e){
    return { host: "(unparseable)", database: "(unparseable)" };
  }
}

function tryAutoBackup(){
  const dir = path.join(__dirname, "..", "backups");
  if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "pre-reset-" + new Date().toISOString().replace(/[:.]/g, "-") + ".dump");
  try{
    execFileSync("pg_dump", [process.env.DATABASE_URL, "-F", "c", "-f", file], { stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, file };
  }catch(e){
    return { ok: false, error: e.message };
  }
}

async function printCounts(models){
  const counts = {};
  for(const step of models){
    counts[typeof step === "string" ? step : step.model] = await prisma[typeof step === "string" ? step : step.model].count();
  }
  return counts;
}

async function main(){
  if(!process.env.DATABASE_URL){
    console.error("❌ DATABASE_URL غير موجود في هذه البيئة — شغّل السكريبت في بيئة معاها اتصال حقيقي بقاعدة بيانات Railway (مثال: railway run node prisma/reset-business-data.js).");
    process.exit(1);
  }

  const target = safeTargetInfo();
  console.log("==================================================");
  console.log("تصفير بيانات العمل التجريبية — " + (EXECUTE ? "⚠️  وضع التنفيذ الفعلي" : "وضع المعاينة (Dry Run) — لا حذف فعلي"));
  console.log("==================================================");
  console.log("الخادم المستهدف (host): " + target.host);
  console.log("اسم القاعدة (database): " + target.database);
  console.log("(لن يتم طباعة اسم المستخدم أو كلمة المرور في أي مكان)");
  console.log("");

  try{
    await prisma.$queryRaw`SELECT 1`;
  }catch(e){
    console.error("❌ فشل الاتصال بقاعدة البيانات:", e.message);
    process.exit(1);
  }
  console.log("✅ الاتصال بقاعدة البيانات تم بنجاح.\n");

  console.log("--- الحالة الحالية قبل أي تنفيذ ---");
  const beforeCounts = await printCounts(DELETION_PLAN);
  for(const step of DELETION_PLAN){
    console.log("  " + step.label + " (" + step.model + "): " + beforeCounts[step.model]);
  }
  console.log("");
  console.log("--- الجداول المحفوظة (لن تُمس أبدًا) ---");
  const preservedCounts = await printCounts(PRESERVED_MODELS);
  for(const m of PRESERVED_MODELS){
    console.log("  " + m + ": " + preservedCounts[m] + " سجل");
  }
  console.log("");

  if(!EXECUTE){
    console.log("🔎 هذا وضع معاينة فقط — لم يُحذف أي شيء.");
    console.log("لتنفيذ الحذف الفعلي بعد المراجعة والموافقة، شغّل:");
    console.log("  node prisma/reset-business-data.js --confirm");
    console.log("أعلام اختيارية: --include-customers-suppliers | --include-categories | --keep-counters");
    await prisma.$disconnect();
    return;
  }

  // نسخة احتياطية قبل أي حذف فعلي — لو pg_dump مش متاح لازم تأكيد صريح
  console.log("--- النسخة الاحتياطية قبل الحذف ---");
  const backup = tryAutoBackup();
  if(backup.ok){
    console.log("✅ اتعملت نسخة احتياطية محلية: " + backup.file + "\n");
  } else {
    console.warn("⚠️  تعذّر عمل نسخة احتياطية تلقائية (pg_dump): " + backup.error);
    if(!HAS_BACKUP_FLAG){
      console.error("\n❌ إيقاف آمن: مفيش نسخة احتياطية تلقائية، ولسه معملتش تأكيد إنك أخدت نسخة يدويًا.");
      console.error("خد نسخة احتياطية أولاً (Railway Dashboard → Database → Backups، أو pg_dump يدوي)،");
      console.error("وبعدين شغّل نفس الأمر تاني مع إضافة --i-have-a-backup لو مصمم تكمل بدون نسخة تلقائية.");
      await prisma.$disconnect();
      process.exit(1);
    }
    console.warn("⚠️  تم تجاوز خطوة النسخ الاحتياطي بناءً على --i-have-a-backup.\n");
  }

  console.log("⚠️  جاري تنفيذ الحذف الفعلي داخل معاملة واحدة (كل الجداول أو ولا حاجة)...\n");

  const deleted = await prisma.$transaction(async (tx) => {
    const out = {};
    for(const step of DELETION_PLAN){
      const r = await tx[step.model].deleteMany({});
      out[step.model] = r.count;
    }
    if(!KEEP_COUNTERS){
      await tx.setting.updateMany({
        data: { invoiceCounter: 1001, purchaseCounter: 1001, orderCounter: 1001, returnCounter: 1001, printingOrderCounter: 1001 }
      });
    }
    return out;
  }, { timeout: 120000 });

  console.log("✅ تم الحذف. ملخص السجلات المحذوفة لكل جدول:\n");
  let total = 0;
  for(const step of DELETION_PLAN){
    console.log("  " + step.label + ": " + deleted[step.model]);
    total += deleted[step.model];
  }
  console.log("  ─────────────────────────────");
  console.log("  إجمالي السجلات المحذوفة: " + total + "\n");

  console.log("--- التحقق الفعلي من قاعدة البيانات بعد التنفيذ ---");
  let allZero = true;
  const afterCounts = await printCounts(DELETION_PLAN);
  for(const step of DELETION_PLAN){
    const c = afterCounts[step.model];
    if(c !== 0){ allZero = false; console.error("  ❌ " + step.label + " لسه فيه " + c + " سجل!"); }
    else console.log("  ✅ " + step.label + ": 0");
  }

  const userCount = await prisma.user.count();
  const adminCount = await prisma.user.count({ where: { role: "admin" } });
  const permCount = await prisma.userPermission.count();
  const settingRow = await prisma.setting.findUnique({ where: { id: "main" } });
  const remainingPT = await prisma.partnerTransaction.count();

  console.log("\n--- التحقق من البيانات المحفوظة ---");
  console.log("  المستخدمون: " + userCount + (userCount > 0 ? " ✅" : " ❌"));
  console.log("  المديرون (admin): " + adminCount + (adminCount > 0 ? " ✅" : " ❌ تحذير: لا يوجد مدير في النظام!"));
  console.log("  صفوف الصلاحيات الدقيقة (UserPermission): " + permCount + " — محفوظة كما هي");
  console.log("  إعدادات النظام (Setting): " + (settingRow ? "موجودة ✅" : "غير موجودة ❌"));
  console.log("  حركات دفتر الشركاء المتبقية: " + remainingPT + " → رصيد مؤمن وعبدو = 0 (SUM(IN)-SUM(OUT) على جدول فاضي)");

  if(!allZero || adminCount === 0 || !settingRow){
    console.error("\n❌ تحقق ما بعد التنفيذ لقى مشكلة — راجع الرسائل فوق فورًا. الحذف نفسه كان جوه transaction ناجحة، لكن فيه شيء غير متوقع في النتيجة.");
    await prisma.$disconnect();
    process.exit(1);
  }

  await prisma.auditLog.create({
    data: {
      id: "reset_" + Date.now().toString(36),
      date: new Date(), userId: null, userName: "System",
      action: "تصفير بيانات النظام",
      detail: "تم تصفير كل بيانات العمل التجريبية تمهيدًا لإدخال بيانات حقيقية — إجمالي " + total + " سجل محذوف."
    }
  });

  console.log("\n✅ اكتمل التصفير بنجاح. النظام جاهز لإدخال بيانات العمل الحقيقية.");
  await prisma.$disconnect();
}

main().catch(async function(e){
  console.error("❌ خطأ غير متوقع أثناء التنفيذ:", e);
  try{ await prisma.$disconnect(); }catch(_){}
  process.exit(1);
});
