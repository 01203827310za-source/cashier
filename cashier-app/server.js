/* ============================================================
   سيستم كاشير محل ملابس — سيرفر (Node.js بدون اعتماديات)
   بيخدم الواجهة + API + قاعدة بيانات PostgreSQL عبر Prisma
   ============================================================ */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, "public");
const db = require('./src/db');
const prisma = db.prisma;

/* ---------- أدوات ---------- */
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function eanCheck(s12){ let sum = 0; for(let i=0;i<12;i++){ const d = +s12[i]; sum += (i%2===0) ? d : d*3; } return String((10 - (sum%10)) % 10); }
function generateEAN13(){ let body = "2"; for(let i=0;i<11;i++) body += Math.floor(Math.random()*10); return body + eanCheck(body); }
function stockOf(p){ return (p.variants||[]).reduce(function(a,v){ return a + (v.stock||0); }, 0); }
function dayKey(ts){ const d = new Date(ts); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }

function buildVariants(sizes, colors, total){
  const sz = (sizes && sizes.length) ? sizes : [null];
  const cl = (colors && colors.length) ? colors : [null];
  const combos = [];
  sz.forEach(function(s){ cl.forEach(function(c){ combos.push([s,c]); }); });
  total = Math.max(0, parseInt(total,10)||0);
  const per = Math.floor(total / combos.length);
  const rem = total % combos.length;
  return combos.map(function(cb, i){
    return { id: uid(), size: cb[0], color: cb[1], stock: per + (i < rem ? 1 : 0), barcode: generateEAN13() };
  });
}

/* ---------- بيانات البداية ---------- */
function seed(){
  function P(name, category, price, cost, stock, sizes, colors, sku, emoji){
    return { id: uid(), name, category, price, cost, stock, sizes, colors, sku, modelCode: sku, emoji, image: "", offer: null,
      variants: buildVariants(sizes, colors, stock) };
  }
  const products = [
    P("تيشيرت قطن أساسي","رجالي",250,120,40,["S","M","L","XL"],["أبيض","أسود","رمادي"],"M-1001","👕"),
    P("بنطلون جينز كلاسيك","رجالي",700,420,25,["30","32","34","36","38"],["أزرق","أسود"],"M-1002","👖"),
    P("قميص رسمي","رجالي",550,300,18,["S","M","L","XL"],["أبيض","أزرق فاتح"],"M-1003","👔"),
    P("جاكت جينز","رجالي",950,550,10,["M","L","XL"],["أزرق"],"M-1004","🧥"),
    P("فستان سهرة","حريمي",1200,700,12,["S","M","L"],["أسود","أحمر"],"W-2001","👗"),
    P("بلوزة شيفون","حريمي",450,230,30,["S","M","L","XL"],["وردي","بيج"],"W-2002","👚"),
    P("عباية كاجوال","حريمي",850,500,20,["مقاس موحد"],["أسود","كحلي"],"W-2003","🥻"),
    P("بليزر نسائي","حريمي",1300,750,8,["S","M","L"],["أسود","رمادي"],"W-2004","🧥"),
    P("طقم أطفال","أطفال",380,200,35,["2-4","4-6","6-8"],["متعدد"],"K-3001","👶"),
    P("حذاء رياضي","أحذية",1100,650,15,["40","41","42","43","44"],["أبيض","أسود"],"S-4001","👟"),
    P("حذاء كعب نسائي","أحذية",600,320,14,["36","37","38","39","40"],["أسود","بيج"],"S-4002","👠"),
    P("شنطة يد","إكسسوارات",500,260,22,["مقاس موحد"],["بني","أسود"],"A-5001","👜"),
    P("كاب رياضية","إكسسوارات",180,80,60,["مقاس موحد"],["أسود","أبيض"],"A-5002","🧢"),
    P("وشاح شتوي","إكسسوارات",220,100,28,["مقاس موحد"],["متعدد"],"A-5003","🧣")
  ];
  return {
    settings: {
      storeName:"29 STORE", currency:"ج.م", taxRate:14, lowStockThreshold:5,
      invoicePrefix:"INV", invoiceCounter:1001, purchaseCounter:1001, orderCounter:1001,
      receiptFooter:"شكراً لزيارتكم — نتمنى لكم يوماً سعيداً", phone:"01000000000"
    },
    users: [
      { id:"u_admin", name:"مدير المتجر", username:"admin", password:"admin", role:"admin", canManageReturns:true },
      { id:"u_cash", name:"كاشير 1", username:"cashier", password:"1234", role:"cashier", canManageReturns:true }
    ],
    categories: ["رجالي","حريمي","أطفال","أحذية","إكسسوارات"],
    products,
    customers: [ { id: uid(), name: "عميل تجريبي", phone: "01012345678", notes: "", createdAt: Date.now(), addresses: [] } ],
    suppliers: [ { id: uid(), name: "مورد تجريبي", phone: "01100000000", notes: "مورد ملابس عام" } ],
    purchases: [], audit: [], sales: [],
    shippingCompanies: [
      { id: uid(), name: "أرامكس", phone: "", notes: "" },
      { id: uid(), name: "بوستة", phone: "", notes: "" },
      { id: uid(), name: "البريد المصري", phone: "", notes: "" }
    ],
    shipPrices: [
      ["القاهرة",45],["الجيزة",45],["الإسكندرية",50],["الشرقية",55],["الدقهلية",55],["القليوبية",50],
      ["الغربية",55],["المنوفية",55],["البحيرة",55],["كفر الشيخ",60],["دمياط",60],["بورسعيد",60],
      ["الإسماعيلية",60],["السويس",60],["الفيوم",60],["بني سويف",60],["المنيا",65],["أسيوط",65],
      ["سوهاج",70],["قنا",70],["الأقصر",70],["أسوان",75],["البحر الأحمر",75],["الوادي الجديد",75],
      ["مطروح",75],["شمال سيناء",75],["جنوب سيناء",75]
    ].map(function(s){ return { id: uid(), governorate: s[0], price: s[1] }; }),
    orders: [],
    expenseCategories: ["إيجار","مرتبات","كهرباء ومياه","شحن وتوصيل","تغليف","إعلانات وتسويق","مصاريف تشغيل","صيانة","أخرى"],
    expenses: [], otherIncome: [], paymentsIn: [], paymentsOut: [], cashClosings: [], transfers: []
  };
}

/* ---------- جلسات الدخول (في الذاكرة — كما كانت) ---------- */
const tokens = new Map(); // token -> userId

/* ---------- سجل الحركات ---------- */
function auditEntry(req, action, detail){
  const u = req.user || null;
  return { id: uid(), date: new Date(), userId: u ? u.id : null, userName: u ? u.name : "النظام", action, detail: detail||"" };
}

/* ---------- أدوات HTTP ---------- */
function send(res, status, obj){
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}
function readBody(req){
  return new Promise(function(resolve){
    let data = "";
    req.on("data", function(c){ data += c; if(data.length > 30*1024*1024) req.destroy(); });
    req.on("end", function(){
      try { resolve(data ? JSON.parse(data) : {}); } catch(e){ resolve({}); }
    });
  });
}
function parseCookies(req){
  const out = {};
  const h = req.headers.cookie || "";
  h.split(";").forEach(function(p){
    const i = p.indexOf("=");
    if(i > -1) out[p.slice(0,i).trim()] = decodeURIComponent(p.slice(i+1).trim());
  });
  return out;
}
async function authUser(req){
  let token = null;
  const c = parseCookies(req);
  if(c.token) token = c.token;
  if(req.headers.authorization && req.headers.authorization.indexOf("Bearer ")===0) token = req.headers.authorization.slice(7);
  if(!token) return null;
  const userId = tokens.get(token);
  if(!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}

/* ---------- مساعدات المخزون ---------- */
async function recomputeProductStock(tx, productId){
  if(!productId) return;
  const agg = await tx.productVariant.aggregate({ where: { productId }, _sum: { stock: true } });
  await tx.product.update({ where: { id: productId }, data: { stock: agg._sum.stock || 0 } });
}
async function adjustVariantStock(tx, variantId, delta){
  if(!variantId) return;
  const variant = await tx.productVariant.findUnique({ where: { id: variantId } });
  if(!variant) return;
  await tx.productVariant.update({ where: { id: variant.id }, data: { stock: Math.max(0, (variant.stock||0) + delta) } });
}
async function restoreOrderStock(tx, orderId){
  const items = await tx.orderItem.findMany({ where: { orderId } });
  for(const it of items){
    if(it.variantId) await adjustVariantStock(tx, it.variantId, it.qty||0);
    await recomputeProductStock(tx, it.productId);
  }
}
/* عند إرجاع/إلغاء أوردر: نعكس كل عربون/تحصيل مسجّل عليه (ORDER_DEPOSIT و
   ORDER_COLLECTION) حتى لا يفضل رصيد أي شريك فيه فلوس تخص أوردر ملغي/مرتجع.
   deleteMany على سجلات محذوفة بالفعل = no-op، فالعملية آمنة للتكرار. */
async function reverseOrderLedger(tx, orderId){
  const collections = await tx.orderCollection.findMany({ where: { orderId } });
  for(const c of collections){
    await tx.partnerTransaction.deleteMany({ where: { referenceType: "orderCollection", referenceId: c.id } });
  }
}
async function restoreOrderStockAndLedger(tx, orderId){
  await restoreOrderStock(tx, orderId);
  await reverseOrderLedger(tx, orderId);
  // بعد عكس كل قيود العربون/التحصيل، الأوردر الملغي/المرتجع ما بقاش مديون
  // بحاجة ولا معاه فلوس محصّلة — نصفّر أعمدة الحالة المالية الحقيقية (الأعمدة
  // تسبق JSON data في مسار القراءة buildStateFromDB، فهي المصدر الفعلي المعروض).
  await tx.order.update({ where: { id: orderId }, data: { collectedTotal: 0, remaining: 0, collectionStatus: null } });
}

/* ---------- الاسترجاع والاستبدال ---------- */
// افتراضي "مسموح": أي كاشير عنده صلاحية بيع أصلاً، إلا لو المدير عطّلها له
// صراحة (canManageReturns === false). العمود جديد وقيمته NULL لكل المستخدمين
// الحاليين، فمعاملتها كـ"غير معطّلة" (!== false) بدل "لازم تبقى true" مهم
// عشان الكاشيرز الموجودين فعلاً في قاعدة بيانات الإنتاج ميتقفلوش فجأة.
function canManageReturns(u){ return !!u && (u.role === "admin" || u.canManageReturns !== false); }
function httpError(status, message){ const e = new Error(message); e.httpStatus = status; return e; }

/* ---------- سجل حسابات الشركاء (مؤمن/عبدو) — المصدر الوحيد لحساب الأرصدة ----------
   referenceType/referenceId يحدّدان الحركة المالية الأصلية بشكل فريد (فاتورة بيع،
   دفعة شراء بعينها، دفعة تحصيل أوردر بعينها، مصروف، إيراد...). الحذف-ثم-الإنشاء
   يجعل التعديل (لمصروف/إيراد له نفس id) آمناً بدون تكرار أو قيود قديمة عالقة. */
async function upsertPartnerLedger(tx, opts){
  if(!opts.referenceType || !opts.referenceId) return;
  await tx.partnerTransaction.deleteMany({ where: { referenceType: opts.referenceType, referenceId: opts.referenceId } });
  if((opts.partner === "moamen" || opts.partner === "abdo") && Number(opts.amount) > 0){
    await tx.partnerTransaction.create({ data: {
      id: uid(), partner: opts.partner, type: opts.type, direction: opts.direction, amount: Number(opts.amount),
      referenceType: opts.referenceType, referenceId: opts.referenceId,
      date: opts.date ? new Date(opts.date) : new Date(), userId: opts.userId || null, notes: opts.notes || null, data: opts
    }});
  }
}
async function deletePartnerLedgerFor(tx, referenceType, referenceId){
  await tx.partnerTransaction.deleteMany({ where: { referenceType, referenceId } });
}
async function restockSaleItem(tx, saleItem, qty){
  if(saleItem.variantId){
    await adjustVariantStock(tx, saleItem.variantId, qty);
  } else if(saleItem.productId && (saleItem.size || saleItem.color)){
    const match = await tx.productVariant.findFirst({ where: { productId: saleItem.productId, size: saleItem.size||null, color: saleItem.color||null } });
    if(match) await adjustVariantStock(tx, match.id, qty);
  } else if(saleItem.productId){
    const first = await tx.productVariant.findFirst({ where: { productId: saleItem.productId } });
    if(first) await adjustVariantStock(tx, first.id, qty);
  }
  if(saleItem.productId) await recomputeProductStock(tx, saleItem.productId);
}
function saleDataFromRow(row){
  return {
    ...(row.data || {}),
    id: row.id,
    number: row.number,
    date: row.date ? row.date.getTime() : null,
    userId: row.userId,
    total: row.total
  };
}
function isCancelledSaleRecord(row){
  return !!row && !!row.data && row.data.status === "cancelled";
}
async function reverseSaleRelatedLedger(tx, saleId){
  await deletePartnerLedgerFor(tx, "sale", saleId);
  const relatedReturns = await tx.saleReturn.findMany({ where: { saleId }, select: { id: true } });
  for(const r of relatedReturns){
    await deletePartnerLedgerFor(tx, "return", r.id);
    await deletePartnerLedgerFor(tx, "return", r.id + "-x");
  }
}
async function restoreOutstandingSaleStock(tx, sale){
  const returnedAgg = await tx.saleReturnItem.groupBy({
    by: ["saleItemId"],
    where: { saleReturn: { saleId: sale.id, status: { not: "ملغي" } } },
    _sum: { qty: true }
  });
  const returnedByItem = {};
  for(const row of returnedAgg) returnedByItem[row.saleItemId] = row._sum.qty || 0;
  for(const item of sale.items){
    const soldQty = item.qty || 0;
    const alreadyReturned = returnedByItem[item.id] || 0;
    const remainingQty = Math.max(0, soldQty - alreadyReturned);
    if(remainingQty > 0) await restockSaleItem(tx, item, remainingQty);
  }
}
function debtStatusFromAmounts(totalAmount, paidAmount){
  if(paidAmount >= totalAmount - 0.004) return "paid";
  if(paidAmount > 0.004) return "partial";
  return "unpaid";
}
function debtDirectionFromType(type){
  return type === "customer_receivable" ? "in" : "out";
}
function debtEntityTypeFromType(type){
  if(type === "customer_receivable") return "customer";
  if(type === "supplier_payable") return "supplier";
  if(type === "partner_personal") return "partner";
  return "person";
}
function debtPersonNameFromInput(input){
  return (input.personName || "").toString().trim();
}
function buildDebtPayload(input, userId){
  const totalAmount = Number(input.totalAmount);
  const paidAmount = Math.max(0, Number(input.paidAmount) || 0);
  if(!(totalAmount > 0)) throw httpError(400, "إجمالي الدين يجب أن يكون أكبر من صفر");
  if(paidAmount < 0) throw httpError(400, "المبلغ المدفوع لا يمكن أن يكون أقل من صفر");
  if(paidAmount > totalAmount + 0.004) throw httpError(400, "المبلغ المدفوع لا يمكن أن يتجاوز إجمالي الدين");

  const type = input.type || "";
  const direction = debtDirectionFromType(type);
  const entityType = debtEntityTypeFromType(type);
  const entityId = input.entityId || null;
  const personName = debtPersonNameFromInput(input);
  const partner = input.partner === "abdo" ? "abdo" : (input.partner === "moamen" ? "moamen" : null);
  const date = input.date ? Number(input.date) : Date.now();
  const remainingAmount = Math.max(0, totalAmount - paidAmount);
  const status = debtStatusFromAmounts(totalAmount, paidAmount);

  if(entityType === "customer" && !entityId) throw httpError(400, "اختر العميل");
  if(entityType === "supplier" && !entityId) throw httpError(400, "اختر المورد");
  if(entityType === "partner" && !partner) throw httpError(400, "اختر الحساب (مؤمن/عبدو)");
  if((entityType === "person" || entityType === "other") && !personName) throw httpError(400, "اسم الشخص / الجهة مطلوب");

  return {
    type,
    entityType,
    entityId,
    personName,
    totalAmount,
    paidAmount,
    remainingAmount,
    status,
    date,
    paymentMethod: input.paymentMethod || null,
    notes: (input.notes || "").trim() || null,
    partner,
    direction,
    userId: userId || null
  };
}
async function reverseDebtLedger(tx, debtId){
  const payments = await tx.debtPayment.findMany({ where: { debtId }, select: { id: true } });
  for(const p of payments){
    await deletePartnerLedgerFor(tx, "debtPayment", p.id);
  }
}
const PARTNER_LABELS = { moamen: "مؤمن", abdo: "عبدو" };
// الديون: المدفوع/المتبقي/الحالة دايمًا محسوبة من SUM(DebtPayment) — مش قيمة
// متراكمة بتتزود يدويًا — عشان التعديل/الحذف الجزئي لأي دفعة يفضل متسق مهما كان
// ترتيب العمليات (نفس مبدأ recomputeProductStock مع ProductVariant).
async function recomputeDebtTotals(tx, debtId){
  const debt = await tx.debt.findUnique({ where: { id: debtId } });
  if(!debt) return null;
  const agg = await tx.debtPayment.aggregate({ where: { debtId }, _sum: { amount: true } });
  const paid = agg._sum.amount || 0;
  const remaining = Math.max(0, (debt.totalAmount || 0) - paid);
  const status = debtStatusFromAmounts(debt.totalAmount || 0, paid);
  const data = { ...(debt.data || {}), paidAmount: paid, remainingAmount: remaining, status };
  return tx.debt.update({ where: { id: debtId }, data: { paidAmount: paid, remainingAmount: remaining, status, data } });
}
// بيبني ويتحقق من بيانات دفعة دين — "مين دفع؟" إلزامي دايمًا، ومحدد حسب اتجاه
// الدين نفسه (مش حسب اختيار الواجهة): دين "لنا" (in) → المدفوع لازم يكون عميل
// حقيقي من جدول Customer؛ أي دين "علينا" (out) → لازم حساب شريك حقيقي
// (مؤمن/عبدو). الاسم المعروض (payerName) بيتحسب من السيرفر مش من اللي بعتته
// الواجهة، عشان محدش يقدر يزوّر الاسم المعروض في سجل الدفعات.
// existingPaidExcluded: مجموع الدفعات التانية غير الدفعة الحالية (لازم يتحسب في
// حالة التعديل قبل ما تتنادى الدالة دي، عشان "المتبقي" يتحسب صح مستبعد الدفعة
// اللي بتتعدل من حسابها).
async function buildDebtPaymentPayload(tx, debt, input, existingPaidExcluded){
  const amount = Number(input.amount);
  if(!(amount > 0)) throw httpError(400, "أدخل مبلغاً صحيحاً");
  if(!input.date) throw httpError(400, "تاريخ الدفعة مطلوب");

  const paidSoFar = existingPaidExcluded != null ? existingPaidExcluded : (debt.paidAmount || 0);
  const remainingBefore = Math.max(0, (debt.totalAmount || 0) - paidSoFar);
  if(remainingBefore <= 0.004) throw httpError(400, "الدين مدفوع بالكامل بالفعل");
  if(amount > remainingBefore + 0.004) throw httpError(400, "قيمة الدفعة أكبر من المبلغ المتبقي.");

  const direction = debt.direction || "out";
  let payerType, payerId, payerName, partner = null;
  if(direction === "in"){
    payerId = (input.payerId || "").toString().trim();
    if(!payerId) throw httpError(400, "اختر مين دفع");
    const customer = await tx.customer.findUnique({ where: { id: payerId } });
    if(!customer) throw httpError(400, "اختر مين دفع");
    payerType = "customer";
    payerName = customer.name;
  } else {
    partner = input.partner === "abdo" ? "abdo" : (input.partner === "moamen" ? "moamen" : null);
    if(!partner) throw httpError(400, "اختر مين دفع");
    payerType = "partner";
    payerId = partner;
    payerName = PARTNER_LABELS[partner];
  }

  return {
    amount, date: Number(input.date), paymentMethod: input.paymentMethod || null,
    notes: (input.notes || "").trim() || null,
    payerType, payerId, payerName, partner, direction
  };
}
async function createDebtPayment(tx, opts){
  const debt = opts.debt;
  const payload = opts.payload;
  const paymentId = opts.id || uid();
  const now = new Date();

  await tx.debtPayment.create({ data: {
    id: paymentId, debtId: debt.id, amount: payload.amount, date: new Date(payload.date),
    paymentMethod: payload.paymentMethod, notes: payload.notes,
    partner: payload.partner, payerType: payload.payerType, payerId: payload.payerId, payerName: payload.payerName,
    direction: payload.direction, userId: opts.userId || null, createdAt: now, updatedAt: now,
    data: {
      id: paymentId, debtId: debt.id, amount: payload.amount, date: payload.date, paymentMethod: payload.paymentMethod,
      notes: payload.notes, partner: payload.partner, payerType: payload.payerType, payerId: payload.payerId,
      payerName: payload.payerName, direction: payload.direction, userId: opts.userId || null
    }
  }});

  if(payload.partner === "moamen" || payload.partner === "abdo"){
    await upsertPartnerLedger(tx, {
      partner: payload.partner,
      type: "DEBT_PAYMENT",
      direction: payload.direction || "out",
      amount: payload.amount,
      referenceType: "debtPayment",
      referenceId: paymentId,
      date: payload.date,
      userId: opts.userId || null,
      notes: "دفعة دين — " + (debt.personName || debt.id)
    });
  }

  await recomputeDebtTotals(tx, debt.id);
  return paymentId;
}

/* ---------- عناصر عامة (إضافة/تعديل/حذف) ---------- */
const genericModels = {
  products: {
    addLabel: "إضافة منتج", editLabel: "تعديل منتج", delLabel: "حذف منتج",
    logDetail: function(it){ return it.name + (it.modelCode ? " (" + it.modelCode + ")" : ""); },
    findOne: function(id){ return prisma.product.findUnique({ where: { id } }); },
    async upsert(tx, it, isNew){
      const stock = stockOf(it);
      it.stock = stock;
      const data = {
        name: it.name, category: it.category || null, price: it.price != null ? it.price : null, cost: it.cost != null ? it.cost : null,
        stock: stock, sku: it.sku || null, modelCode: it.modelCode, image: it.image || null, emoji: it.emoji || null, data: it
      };
      if(isNew){
        await tx.product.create({ data: { id: it.id, ...data,
          variants: { create: (it.variants||[]).map(function(v){ return { id: v.id || uid(), size: v.size||null, color: v.color||null, stock: v.stock!=null?v.stock:null, barcode: v.barcode||null }; }) }
        }});
      } else {
        await tx.product.update({ where: { id: it.id }, data });
        const keepIds = (it.variants||[]).map(function(v){ return v.id; }).filter(Boolean);
        await tx.productVariant.deleteMany({ where: { productId: it.id, id: { notIn: keepIds.length ? keepIds : ["__none__"] } } });
        for(const v of (it.variants||[])){
          const vid = v.id || uid();
          await tx.productVariant.upsert({
            where: { id: vid },
            update: { size: v.size||null, color: v.color||null, stock: v.stock!=null?v.stock:null, barcode: v.barcode||null },
            create: { id: vid, productId: it.id, size: v.size||null, color: v.color||null, stock: v.stock!=null?v.stock:null, barcode: v.barcode||null }
          });
        }
      }
    },
    async remove(tx, id){ await tx.product.delete({ where: { id } }); }
  },
  customers: {
    addLabel: "إضافة عميل", editLabel: "تعديل عميل", delLabel: "حذف عميل",
    logDetail: function(it){ return it.name; },
    findOne: function(id){ return prisma.customer.findUnique({ where: { id } }); },
    async upsert(tx, it, isNew){
      const data = { name: it.name, phone: it.phone || null, notes: it.notes || null, addresses: it.addresses || [] };
      if(isNew) await tx.customer.create({ data: { id: it.id, ...data, createdAt: it.createdAt ? new Date(it.createdAt) : new Date() } });
      else await tx.customer.update({ where: { id: it.id }, data });
    },
    async remove(tx, id){ await tx.customer.delete({ where: { id } }); }
  },
  suppliers: {
    addLabel: "إضافة مورد", editLabel: "تعديل مورد", delLabel: "حذف مورد",
    logDetail: function(it){ return it.name; },
    findOne: function(id){ return prisma.supplier.findUnique({ where: { id } }); },
    async upsert(tx, it, isNew){
      const data = { name: it.name, phone: it.phone || null, notes: it.notes || null };
      if(isNew) await tx.supplier.create({ data: { id: it.id, ...data } });
      else await tx.supplier.update({ where: { id: it.id }, data });
    },
    async remove(tx, id){ await tx.supplier.delete({ where: { id } }); }
  },
  expenses: {
    addLabel: "مصروف", editLabel: "تعديل مصروف", delLabel: "حذف مصروف",
    logDetail: function(it){ return it.note || it.category; },
    findOne: function(id){ return prisma.expense.findUnique({ where: { id } }); },
    async upsert(tx, it, isNew){
      const data = { category: it.category || null, amount: it.amount != null ? it.amount : null, date: it.date ? new Date(it.date) : new Date(), note: it.note || null, userId: it.userId || null, partner: it.partner || null, data: it };
      if(isNew) await tx.expense.create({ data: { id: it.id, ...data } });
      else await tx.expense.update({ where: { id: it.id }, data });
    },
    async remove(tx, id){ await tx.expense.delete({ where: { id } }); }
  },
  income: {
    addLabel: "إيراد آخر", editLabel: "تعديل إيراد", delLabel: "حذف إيراد آخر",
    logDetail: function(it){ return it.note || ""; },
    findOne: function(id){ return prisma.otherIncome.findUnique({ where: { id } }); },
    async upsert(tx, it, isNew){
      const data = { note: it.note || null, amount: it.amount != null ? it.amount : null, date: it.date ? new Date(it.date) : new Date(), userId: it.userId || null, partner: it.partner || null, data: it };
      if(isNew) await tx.otherIncome.create({ data: { id: it.id, ...data } });
      else await tx.otherIncome.update({ where: { id: it.id }, data });
    },
    async remove(tx, id){ await tx.otherIncome.delete({ where: { id } }); }
  },
  users: {
    addLabel: "إضافة مستخدم", editLabel: "تعديل مستخدم", delLabel: "حذف مستخدم",
    logDetail: function(it){ return it.username; },
    findOne: function(id){ return prisma.user.findUnique({ where: { id } }); },
    async upsert(tx, it, isNew){
      const data = { name: it.name || null, username: it.username, password: it.password, role: it.role || null, canManageReturns: it.canManageReturns === false ? false : true };
      if(isNew) await tx.user.create({ data: { id: it.id, ...data } });
      else await tx.user.update({ where: { id: it.id }, data });
    },
    async remove(tx, id){ await tx.user.delete({ where: { id } }); }
  }
};

/* ---------- تحديث حالة أوردر (مشترك بين الحالة/الشحن/COD/الإرجاع/الإلغاء) ---------- */
async function orderPatch(id, req, res, mutateFn, actionLabelFn, txExtraFn){
  const existing = await prisma.order.findUnique({ where: { id } });
  if(!existing){ send(res, 404, {ok:false}); return; }
  const merged = { ...(existing.data||{}), id: existing.id, number: existing.number,
    date: existing.date ? existing.date.getTime() : null, userId: existing.userId,
    customerName: existing.customerName, total: existing.total, status: existing.status };
  mutateFn(merged);
  await prisma.$transaction(async function(tx){
    if(txExtraFn) await txExtraFn(tx, id);
    await tx.order.update({ where: { id }, data: {
      status: merged.status || null,
      customerName: merged.customerName || null,
      total: merged.total != null ? merged.total : null,
      data: merged
    }});
    const detail = actionLabelFn(merged);
    if(detail) await tx.auditLog.create({ data: auditEntry(req, detail.action, detail.detail) });
  }, { timeout: 30000 });
  await db.trimAuditLog();
  const state = await db.buildStateFromDB();
  send(res, 200, { ok:true, db: state });
}

/* ---------- توجيه الطلبات ---------- */
const server = http.createServer(async function(req, res){
 try {
  const url = (req.url || "/").split("?")[0];
  const method = req.method || "GET";

  // --- ملفات ثابتة ---
  if(method === "GET" && url.indexOf("/api/") !== 0){
    let file = url === "/" ? "index.html" : url.slice(1);
    file = path.join(PUBLIC_DIR, file);
    if(!file.startsWith(PUBLIC_DIR)){ send(res,403,{ok:false}); return; }
    fs.readFile(file, function(err, buf){
      if(err){ res.writeHead(404, {"Content-Type":"text/plain; charset=utf-8"}); res.end("Not found"); return; }
      const ext = path.extname(file).toLowerCase();
      const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".png":"image/png", ".jpg":"image/jpeg", ".svg":"image/svg+xml" };
      res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
      res.end(buf);
    });
    return;
  }

  /* ---------- عام ---------- */
  // فحص صحة السيرفر — لازم يرجع 200 فوراً من غير أي استعلام على قاعدة البيانات
  // (Railway بيعتمد عليه عشان يعرف إن الديبلوي نجح)
  if(method === "GET" && url === "/api/health"){ send(res, 200, {status:"ok"}); return; }

  if(method === "POST" && url === "/api/login"){
    const b = await readBody(req);
    const u = await prisma.user.findFirst({ where: { username: (b.username||"").trim(), password: b.password||"" } });
    if(!u){ send(res, 401, {ok:false, error:"بيانات الدخول غير صحيحة"}); return; }
    const token = crypto.randomUUID();
    tokens.set(token, u.id);
    res.setHeader("Set-Cookie", "token="+token+"; HttpOnly; Path=/; SameSite=Lax; Max-Age=" + 60*60*24*30);
    await prisma.auditLog.create({ data: auditEntry({user:u}, "تسجيل دخول", u.name) });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, token, user:{id:u.id, name:u.name, username:u.username, role:u.role}, db: state });
    return;
  }
  if(method === "POST" && url === "/api/logout"){
    const c = parseCookies(req);
    if(c.token) tokens.delete(c.token);
    res.setHeader("Set-Cookie", "token=; HttpOnly; Path=/; Max-Age=0");
    send(res, 200, {ok:true});
    return;
  }

  // --- كل الباقي يتطلب تسجيل دخول ---
  const user = await authUser(req);
  if(!user){ send(res, 401, {ok:false, error:"غير مسجل دخول"}); return; }
  req.user = user;

  if(method === "GET" && url === "/api/state"){
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state, userId: user.id });
    return;
  }

  /* ---------- البيع ---------- */
  if(method === "POST" && url === "/api/sale"){
    const b = await readBody(req);
    const saleIn = b.sale || {};
    const decrements = b.decrements || [];
    const saleId = saleIn.id || uid();
    await prisma.$transaction(async function(tx){
      const setting = await tx.setting.findUnique({ where: { id: 'main' } });
      const settings = (setting && setting.data) || {};
      const counter = settings.invoiceCounter || 1001;
      saleIn.id = saleId;
      saleIn.number = (settings.invoicePrefix || "INV") + "-" + counter;
      saleIn.date = Date.now();
      saleIn.userId = user.id;
      settings.invoiceCounter = counter + 1;
      await tx.setting.update({ where: { id: 'main' }, data: { invoiceCounter: settings.invoiceCounter, data: settings } });

      await tx.sale.create({ data: {
        id: saleIn.id, number: saleIn.number, date: new Date(saleIn.date), userId: saleIn.userId, total: saleIn.total != null ? saleIn.total : null, data: saleIn,
        items: { create: (saleIn.items||[]).map(function(it){ return { id: uid(), productId: it.productId||null, variantId: it.variantId||null, price: it.price!=null?it.price:null, qty: it.qty!=null?it.qty:null, size: it.size||null, color: it.color||null, data: it }; }) }
      }});

      for(const d of decrements){
        await adjustVariantStock(tx, d.variantId, -(d.qty||0));
        await recomputeProductStock(tx, d.productId);
      }

      await upsertPartnerLedger(tx, { partner: "moamen", type: "SALE", direction: "in", amount: saleIn.total,
        referenceType: "sale", referenceId: saleIn.id, date: saleIn.date, userId: user.id, notes: "بيع — " + saleIn.number });

      await tx.auditLog.create({ data: auditEntry(req, "بيع", "فاتورة " + saleIn.number + " — " + saleIn.total + " " + (settings.currency||"")) });
    }, { timeout: 30000 });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    const savedSale = state.sales.find(function(s){ return s.id === saleId; });
    send(res, 200, { ok:true, db: state, sale: savedSale });
    return;
  }
  if(method === "POST" && /^\/api\/sale\/[^/]+\/return$/.test(url)){
    const id = url.split("/")[3];
    const existing = await prisma.sale.findUnique({ where: { id }, include: { items: true } });
    if(!existing){ send(res, 404, {ok:false}); return; }
    await prisma.$transaction(async function(tx){
      for(const it of existing.items){
        if(it.variantId){
          await adjustVariantStock(tx, it.variantId, it.qty||0);
        } else if(it.productId && (it.size || it.color)){
          const match = await tx.productVariant.findFirst({ where: { productId: it.productId, size: it.size||null, color: it.color||null } });
          if(match) await adjustVariantStock(tx, match.id, it.qty||0);
        } else if(it.productId){
          const first = await tx.productVariant.findFirst({ where: { productId: it.productId } });
          if(first) await adjustVariantStock(tx, first.id, it.qty||0);
        }
        await recomputeProductStock(tx, it.productId);
      }
      await deletePartnerLedgerFor(tx, "sale", id);
      await tx.sale.delete({ where: { id } });
      await tx.auditLog.create({ data: auditEntry(req, "إرجاع فاتورة", existing.number || "") });
    }, { timeout: 30000 });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  if(method === "POST" && /^\/api\/sale\/[^/]+\/cancel$/.test(url)){
    const id = url.split("/")[3];
    const b = await readBody(req);
    const reason = (b.reason || "").trim() || null;
    const existing = await prisma.sale.findUnique({ where: { id }, include: { items: true } });
    if(!existing){ send(res, 404, { ok:false, error:"الفاتورة غير موجودة" }); return; }
    if(isCancelledSaleRecord(existing)){ send(res, 409, { ok:false, error:"الفاتورة ملغاة بالفعل" }); return; }
    try{
      await prisma.$transaction(async function(tx){
        const fresh = await tx.sale.findUnique({ where: { id }, include: { items: true } });
        if(!fresh) throw httpError(404, "الفاتورة غير موجودة");
        if(isCancelledSaleRecord(fresh)) throw httpError(409, "الفاتورة ملغاة بالفعل");

        const merged = saleDataFromRow(fresh);
        merged.status = "cancelled";
        merged.cancelledAt = Date.now();
        merged.cancelledBy = user.id;
        merged.cancellationReason = reason;

        await restoreOutstandingSaleStock(tx, fresh);
        await reverseSaleRelatedLedger(tx, id);
        await tx.sale.update({ where: { id }, data: { data: merged } });
        await tx.auditLog.create({ data: auditEntry(req, "إلغاء فاتورة", (fresh.number || "") + (reason ? (" — " + reason) : "")) });
      }, { timeout: 30000 });
    }catch(err){
      if(err && err.httpStatus){ send(res, err.httpStatus, { ok:false, error: err.message }); return; }
      throw err;
    }

    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }

  /* ---------- الاسترجاع والاستبدال (استرجاع جزئي/كامل لفاتورة قائمة — لا يحذف الفاتورة الأصلية) ---------- */
  if(method === "POST" && url === "/api/returns"){
    if(!canManageReturns(user)){ send(res, 403, {ok:false, error:"ليس لديك صلاحية إدارة الاسترجاع والاستبدال"}); return; }
    const b = await readBody(req);
    const saleId = b.saleId;
    const type = b.type === "exchange" ? "exchange" : "return";
    const reqItems = Array.isArray(b.items) ? b.items : [];
    const reason = (b.reason||"").trim();
    const refundMethod = b.refundMethod === "credit" ? "credit" : (b.refundMethod === "cash" ? "cash" : null);
    const customerId = b.customerId || null;

    if(!saleId){ send(res, 400, {ok:false, error:"رقم الفاتورة مطلوب"}); return; }
    if(!reqItems.length){ send(res, 400, {ok:false, error:"اختر صنفاً واحداً على الأقل للاسترجاع"}); return; }

    const sale = await prisma.sale.findUnique({ where: { id: saleId }, include: { items: true } });
    if(!sale){ send(res, 404, {ok:false, error:"الفاتورة غير موجودة"}); return; }

    const returnId = uid();
    try{
      await prisma.$transaction(async function(tx){
        let returnedTotal = 0, replacementTotal = 0;
        const lineData = [];
        const requestedSoFar = {}; // saleItemId -> qty already staged within this same request

        for(const reqIt of reqItems){
          const qty = parseInt(reqIt.qty, 10) || 0;
          if(qty <= 0) throw httpError(400, "الكمية المرتجعة يجب أن تكون أكبر من صفر");

          const saleItem = sale.items.find(function(si){ return si.id === reqIt.saleItemId; });
          if(!saleItem) throw httpError(400, "صنف غير موجود في هذه الفاتورة");

          const agg = await tx.saleReturnItem.aggregate({ where: { saleItemId: saleItem.id, saleReturn: { status: { not: "ملغي" } } }, _sum: { qty: true } });
          const alreadyReturned = (agg._sum.qty || 0) + (requestedSoFar[saleItem.id] || 0);
          const remaining = (saleItem.qty || 0) - alreadyReturned;
          if(qty > remaining) throw httpError(400, "الكمية المطلوب استرجاعها ("+qty+") أكبر من المتاح للاسترجاع ("+remaining+")");
          requestedSoFar[saleItem.id] = (requestedSoFar[saleItem.id] || 0) + qty;

          const unitPrice = saleItem.price || 0;
          const lineTotal = unitPrice * qty;
          returnedTotal += lineTotal;

          const prod = saleItem.productId ? await tx.product.findUnique({ where: { id: saleItem.productId } }) : null;

          const lineRec = {
            id: uid(), saleItemId: saleItem.id, productId: saleItem.productId||null, variantId: saleItem.variantId||null,
            modelCode: prod ? prod.modelCode : null, size: saleItem.size||null, color: saleItem.color||null,
            qty: qty, unitPrice: unitPrice, lineTotal: lineTotal,
            condition: (reqIt.condition||"").trim() || null,
            replacementProductId: null, replacementVariantId: null, replacementQty: null, replacementPrice: null,
            data: reqIt
          };

          await restockSaleItem(tx, saleItem, qty);

          if(type === "exchange" && reqIt.replacementVariantId){
            const repQty = parseInt(reqIt.replacementQty, 10) || 0;
            if(repQty <= 0) throw httpError(400, "كمية المنتج البديل يجب أن تكون أكبر من صفر");
            const repVariant = await tx.productVariant.findUnique({ where: { id: reqIt.replacementVariantId } });
            if(!repVariant) throw httpError(400, "المتغير البديل غير موجود");
            if((repVariant.stock||0) < repQty) throw httpError(400, "الكمية المتاحة من المنتج البديل غير كافية");
            const repProduct = await tx.product.findUnique({ where: { id: repVariant.productId } });
            const repPrice = (reqIt.replacementPrice != null) ? Number(reqIt.replacementPrice) : (repProduct ? (repProduct.price||0) : 0);
            replacementTotal += repPrice * repQty;

            lineRec.replacementProductId = repVariant.productId;
            lineRec.replacementVariantId = repVariant.id;
            lineRec.replacementQty = repQty;
            lineRec.replacementPrice = repPrice;

            await adjustVariantStock(tx, repVariant.id, -repQty);
            await recomputeProductStock(tx, repVariant.productId);
          }

          lineData.push(lineRec);
        }

        const priorAgg = await tx.saleReturnItem.aggregate({ where: { saleReturn: { saleId: sale.id, status: { not: "ملغي" } } }, _sum: { qty: true } });
        const totalReturnedQty = (priorAgg._sum.qty || 0) + lineData.reduce(function(a,l){ return a + l.qty; }, 0);
        const totalSoldQty = sale.items.reduce(function(a,si){ return a + (si.qty||0); }, 0);
        const status = type === "exchange" ? "مستبدل" : (totalReturnedQty >= totalSoldQty ? "مسترجع بالكامل" : "مسترجع جزئيًا");
        const difference = replacementTotal - returnedTotal;

        const setting = await tx.setting.findUnique({ where: { id: 'main' } });
        const settings = (setting && setting.data) || {};
        const counter = settings.returnCounter || 1001;
        const number = (type === "exchange" ? "EXC-" : "RET-") + counter;
        settings.returnCounter = counter + 1;
        await tx.setting.update({ where: { id: 'main' }, data: { returnCounter: settings.returnCounter, data: settings } });

        await tx.saleReturn.create({ data: {
          id: returnId, number, type, saleId: sale.id, customerId: customerId, userId: user.id, date: new Date(),
          reason: reason || null, status, refundMethod: refundMethod,
          returnedTotal: returnedTotal, replacementTotal: replacementTotal, difference: difference,
          data: { reason, refundMethod, customerId },
          items: { create: lineData }
        }});

        await upsertPartnerLedger(tx, { partner: "moamen", type: "RETURN", direction: "out", amount: returnedTotal,
          referenceType: "return", referenceId: returnId, date: Date.now(), userId: user.id, notes: "استرجاع — " + number });
        if(type === "exchange" && replacementTotal > 0){
          await upsertPartnerLedger(tx, { partner: "moamen", type: "EXCHANGE_ADJUSTMENT", direction: "in", amount: replacementTotal,
            referenceType: "return", referenceId: returnId + "-x", date: Date.now(), userId: user.id, notes: "استبدال (بديل) — " + number });
        }

        await tx.auditLog.create({ data: auditEntry(req, type === "exchange" ? "استبدال" : "استرجاع",
          (sale.number||"") + " — " + number + (type === "exchange" ? (" — الفرق " + difference) : (" — قيمة " + returnedTotal))) });
      }, { timeout: 30000 });
    }catch(err){
      if(err && err.httpStatus){ send(res, err.httpStatus, { ok:false, error: err.message }); return; }
      throw err;
    }

    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    const savedReturn = state.returns.find(function(r){ return r.id === returnId; });
    send(res, 200, { ok:true, db: state, saleReturn: savedReturn });
    return;
  }
  // إلغاء استرجاع/استبدال قائم — بيعكس بالظبط الآثار اللي حصلت وقت إنشائه:
  // (1) المخزون: القطعة المرتجعة الأصلية كانت اتضافت (restockSaleItem بفرق موجب)
  //     → بنشيلها تاني بفرق سالب؛ والقطعة البديلة (لو استبدال) كانت اتخصمت
  //     → بنرجّعها. (2) الدفتر: بنمسح قيدي "return" و"return-x" بالظبط (نفس آلية
  //     reverseSaleRelatedLedger). السجل نفسه بيفضل موجود بحالة "ملغي" بدل ما يتحذف.
  // idempotent: أي محاولة إلغاء تانية على سجل status="ملغي" بالفعل بترفض فوراً
  // قبل ما تلمس أي مخزون أو دفتر.
  if(method === "POST" && /^\/api\/returns\/[^/]+\/cancel$/.test(url)){
    if(!canManageReturns(user)){ send(res, 403, {ok:false, error:"ليس لديك صلاحية إدارة الاسترجاع والاستبدال"}); return; }
    const id = url.split("/")[3];
    const b = await readBody(req);
    const reason = (b.reason || "").trim() || null;
    const existing = await prisma.saleReturn.findUnique({ where: { id }, include: { items: true } });
    if(!existing){ send(res, 404, { ok:false, error:"سجل الاسترجاع غير موجود" }); return; }
    if(existing.status === "ملغي"){ send(res, 409, { ok:false, error:"هذا السجل ملغي بالفعل" }); return; }
    try{
      await prisma.$transaction(async function(tx){
        const fresh = await tx.saleReturn.findUnique({ where: { id }, include: { items: true } });
        if(!fresh) throw httpError(404, "سجل الاسترجاع غير موجود");
        if(fresh.status === "ملغي") throw httpError(409, "هذا السجل ملغي بالفعل");

        for(const item of fresh.items){
          if(item.qty){
            const saleItem = await tx.saleItem.findUnique({ where: { id: item.saleItemId } });
            if(saleItem) await restockSaleItem(tx, saleItem, -item.qty);
          }
          if(item.replacementVariantId && item.replacementQty){
            await adjustVariantStock(tx, item.replacementVariantId, item.replacementQty);
            if(item.replacementProductId) await recomputeProductStock(tx, item.replacementProductId);
          }
        }

        await deletePartnerLedgerFor(tx, "return", id);
        await deletePartnerLedgerFor(tx, "return", id + "-x");

        const mergedData = { ...(fresh.data||{}), statusBeforeCancel: fresh.status, cancelledAt: Date.now(), cancelledBy: user.id, cancellationReason: reason };
        await tx.saleReturn.update({ where: { id }, data: { status: "ملغي", data: mergedData } });

        await tx.auditLog.create({ data: auditEntry(req, "إلغاء استرجاع/استبدال", (fresh.number || "") + (reason ? (" — " + reason) : "")) });
      }, { timeout: 30000 });
    }catch(err){
      if(err && err.httpStatus){ send(res, err.httpStatus, { ok:false, error: err.message }); return; }
      throw err;
    }
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }

  /* ---------- الأوردرات ---------- */
  if(method === "POST" && url === "/api/order"){
    const b = await readBody(req);
    const orderIn = b.order || {};
    const decrements = b.decrements || [];
    const orderId = orderIn.id || uid();
    await prisma.$transaction(async function(tx){
      const setting = await tx.setting.findUnique({ where: { id: 'main' } });
      const settings = (setting && setting.data) || {};
      const counter = settings.orderCounter || 1001;
      orderIn.id = orderId;
      orderIn.number = "ORD-" + counter;
      orderIn.date = Date.now();
      orderIn.userId = user.id;
      settings.orderCounter = counter + 1;
      await tx.setting.update({ where: { id: 'main' }, data: { orderCounter: settings.orderCounter, data: settings } });

      const orderTotal = orderIn.total != null ? Number(orderIn.total) : 0;
      const deposit = Math.max(0, Math.min(orderTotal, Number(orderIn.deposit) || 0));
      const remaining = Math.max(0, orderTotal - deposit);
      const collectionStatus = remaining <= 0.004 ? "collected" : "pending";
      orderIn.deposit = deposit; orderIn.collectedTotal = deposit; orderIn.remaining = remaining; orderIn.collectionStatus = collectionStatus;

      await tx.order.create({ data: {
        id: orderIn.id, number: orderIn.number, date: new Date(orderIn.date), userId: orderIn.userId,
        customerName: orderIn.customerName || null, total: orderTotal, status: orderIn.status || "new",
        deposit: deposit, collectedTotal: deposit, remaining: remaining, collectionStatus: collectionStatus, data: orderIn,
        items: { create: (orderIn.items||[]).map(function(it){ return { id: uid(), productId: it.productId||null, variantId: it.variantId||null, qty: it.qty!=null?it.qty:null, price: it.price!=null?it.price:null, data: it }; }) }
      }});

      for(const d of decrements){
        await adjustVariantStock(tx, d.variantId, -(d.qty||0));
        await recomputeProductStock(tx, d.productId);
      }

      if(deposit > 0){
        const collId = uid();
        await tx.orderCollection.create({ data: {
          id: collId, orderId: orderIn.id, kind: "deposit", amount: deposit, date: new Date(orderIn.date),
          paymentMethod: orderIn.depositMethod || null, partner: "abdo", notes: "عربون عند إنشاء الطلب", userId: user.id, data: {}
        }});
        await upsertPartnerLedger(tx, { partner: "abdo", type: "ORDER_DEPOSIT", direction: "in", amount: deposit,
          referenceType: "orderCollection", referenceId: collId, date: orderIn.date, userId: user.id, notes: "عربون — " + orderIn.number });
      }

      await tx.auditLog.create({ data: auditEntry(req, "أوردر جديد", orderIn.number + " — " + orderIn.customerName + " — " + orderIn.total + " " + (settings.currency||"")) });
    }, { timeout: 30000 });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    const savedOrder = state.orders.find(function(o){ return o.id === orderId; });
    send(res, 200, { ok:true, db: state, order: savedOrder });
    return;
  }
  if(method === "POST" && /^\/api\/order\/[^/]+\/status$/.test(url)){
    const id = url.split("/")[3];
    const b = await readBody(req);
    await orderPatch(id, req, res, function(o){
      o.status = b.status;
      if(b.status==="shipped") o.shippedDate = Date.now();
      if(b.status==="delivered") o.deliveredDate = Date.now();
    }, function(o){ return { action: "تحديث حالة أوردر", detail: o.number+" → "+b.status }; });
    return;
  }
  if(method === "POST" && /^\/api\/order\/[^/]+\/shipment$/.test(url)){
    const id = url.split("/")[3];
    const b = await readBody(req);
    await orderPatch(id, req, res, function(o){
      o.companyId = b.companyId || null; o.awb = (b.awb||"").trim();
    }, function(o){ return { action: "تحديث شحنة", detail: o.number + (o.awb ? " — "+o.awb : "") }; });
    return;
  }
  /* ---------- تحصيل COD (نظام قديم — تم توحيده مع OrderCollection/PartnerTransaction) ----------
     "إلغاء تحصيل" (collected:false) يعكس فقط الدفعة المرتبطة بـcodCollectionId المسجّلة في
     data — وليس أي دفعة/عربون آخر على نفس الأوردر. "تسجيل تحصيل" (الافتراضي) بيمر إجبارياً
     عبر نفس منطق /collection: يتطلب partner، يُنشئ OrderCollection + PartnerTransaction،
     ويحدّث collectedTotal/remaining/collectionStatus الحقيقية — بدل الحقول القديمة المنفصلة
     المستخدمة فقط للعرض التاريخي الآن. */
  if(method === "POST" && /^\/api\/order\/[^/]+\/cod$/.test(url)){
    const id = url.split("/")[3];
    const b = await readBody(req);
    const existingOrder = await prisma.order.findUnique({ where: { id } });
    if(!existingOrder){ send(res, 404, {ok:false}); return; }

    if(b.collected === false){
      try{
        await prisma.$transaction(async function(tx){
          const fresh = await tx.order.findUnique({ where: { id } });
          const merged = { ...(fresh.data||{}) };
          const codCollectionId = merged.codCollectionId || null;
          if(codCollectionId){
            const coll = await tx.orderCollection.findUnique({ where: { id: codCollectionId } });
            if(coll){
              await tx.partnerTransaction.deleteMany({ where: { referenceType: "orderCollection", referenceId: codCollectionId } });
              await tx.orderCollection.delete({ where: { id: codCollectionId } });
              const newCollected = Math.max(0, (fresh.collectedTotal||0) - (coll.amount||0));
              const total = fresh.total || 0;
              const remaining = Math.max(0, total - newCollected);
              const collectionStatus = remaining <= 0.004 ? "collected" : "pending";
              await tx.order.update({ where: { id }, data: { collectedTotal: newCollected, remaining, collectionStatus } });
            }
          }
          merged.collected = false; merged.collectedBy = null; merged.collectedAt = null; merged.collectedAmount = null; merged.codCollectionId = null;
          await tx.order.update({ where: { id }, data: { data: merged } });
          await tx.auditLog.create({ data: auditEntry(req, "إلغاء تحصيل COD", fresh.number || "") });
        }, { timeout: 30000 });
      }catch(err){
        if(err && err.httpStatus){ send(res, err.httpStatus, { ok:false, error: err.message }); return; }
        throw err;
      }
      await db.trimAuditLog();
      const state = await db.buildStateFromDB();
      send(res, 200, { ok:true, db: state });
      return;
    }

    const amount = Number(b.amount);
    const partner = b.partner === "abdo" ? "abdo" : (b.partner === "moamen" ? "moamen" : null);
    if(!(amount > 0)){ send(res, 400, {ok:false, error:"أدخل مبلغاً صحيحاً"}); return; }
    if(!partner){ send(res, 400, {ok:false, error:"اختر الحساب (مؤمن/عبدو)"}); return; }
    const byUser = await prisma.user.findUnique({ where: { id: b.byId || user.id } });

    const collId = uid();
    try{
      await prisma.$transaction(async function(tx){
        const fresh = await tx.order.findUnique({ where: { id } });
        const total = fresh.total || 0;
        const currentCollected = fresh.collectedTotal || 0;
        const newCollected = currentCollected + amount;
        if(newCollected > total + 0.004) throw httpError(400, "إجمالي المحصَّل ("+newCollected+") يتجاوز إجمالي الفاتورة ("+total+")");
        const remaining = Math.max(0, total - newCollected);
        const collectionStatus = remaining <= 0.004 ? "collected" : "pending";

        const merged = { ...(fresh.data||{}) };
        merged.collected = true; merged.collectedBy = b.byId || user.id; merged.collectedAt = Date.now(); merged.collectedAmount = amount; merged.codCollectionId = collId;

        await tx.order.update({ where: { id }, data: { collectedTotal: newCollected, remaining, collectionStatus, data: merged } });

        const payDate = Date.now();
        await tx.orderCollection.create({ data: {
          id: collId, orderId: id, kind: "collection", amount: amount, date: new Date(payDate),
          paymentMethod: "cod", partner: partner, notes: "تحصيل COD", userId: user.id, data: {}
        }});
        await upsertPartnerLedger(tx, { partner, type: "ORDER_COLLECTION", direction: "in", amount,
          referenceType: "orderCollection", referenceId: collId, date: payDate, userId: user.id, notes: "تحصيل COD — " + (fresh.number||"") });

        await tx.auditLog.create({ data: auditEntry(req, "تحصيل COD", (fresh.number||"") + " — " + amount + " (" + (byUser?byUser.name:"") + ")") });
      }, { timeout: 30000 });
    }catch(err){
      if(err && err.httpStatus){ send(res, err.httpStatus, { ok:false, error: err.message }); return; }
      throw err;
    }
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  if(method === "POST" && /^\/api\/order\/[^/]+\/collection$/.test(url)){
    const id = url.split("/")[3];
    const b = await readBody(req);
    const amount = Number(b.amount);
    const partner = b.partner === "abdo" ? "abdo" : (b.partner === "moamen" ? "moamen" : null);
    if(!(amount > 0)){ send(res, 400, {ok:false, error:"أدخل مبلغاً صحيحاً"}); return; }
    if(!partner){ send(res, 400, {ok:false, error:"اختر الحساب (مؤمن/عبدو)"}); return; }
    const order = await prisma.order.findUnique({ where: { id } });
    if(!order){ send(res, 404, {ok:false, error:"الطلب غير موجود"}); return; }

    const collId = uid();
    try{
      await prisma.$transaction(async function(tx){
        const fresh = await tx.order.findUnique({ where: { id } });
        const total = fresh.total || 0;
        const currentCollected = fresh.collectedTotal || 0;
        const newCollected = currentCollected + amount;
        if(newCollected > total + 0.004) throw httpError(400, "إجمالي المحصَّل ("+newCollected+") يتجاوز إجمالي الفاتورة ("+total+")");
        const remaining = Math.max(0, total - newCollected);
        const collectionStatus = remaining <= 0.004 ? "collected" : "pending";

        await tx.order.update({ where: { id }, data: { collectedTotal: newCollected, remaining, collectionStatus } });

        const payDate = Date.now();
        await tx.orderCollection.create({ data: {
          id: collId, orderId: id, kind: "collection", amount: amount, date: new Date(payDate),
          paymentMethod: b.paymentMethod || "cash", partner: partner, notes: (b.notes||"").trim() || null, userId: user.id, data: {}
        }});
        await upsertPartnerLedger(tx, { partner, type: "ORDER_COLLECTION", direction: "in", amount,
          referenceType: "orderCollection", referenceId: collId, date: payDate, userId: user.id, notes: "تحصيل لاحق — " + (fresh.number||"") });

        await tx.auditLog.create({ data: auditEntry(req, "تحصيل دفعة أوردر", (fresh.number||"") + " — " + amount) });
      }, { timeout: 30000 });
    }catch(err){
      if(err && err.httpStatus){ send(res, err.httpStatus, { ok:false, error: err.message }); return; }
      throw err;
    }
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  // إرجاع/إلغاء أوردر لازم يكونوا idempotent صراحة (مش بس عن طريق orderPatch
  // العام) — restoreOrderStockAndLedger بيرجّع الكمية بلا شرط في كل استدعاء،
  // فلو الأوردر بالفعل "returned"/"cancelled" واتنادت تاني (نداء API مباشر أو
  // تسابق طلبات)، المخزون هيتزوّد مرتين. نفس نمط /api/sale/:id/cancel بالظبط:
  // تحقق أولي + إعادة تحقق جوه الـ transaction على أحدث نسخة من الصف.
  if(method === "POST" && /^\/api\/order\/[^/]+\/return$/.test(url)){
    const id = url.split("/")[3];
    const existing = await prisma.order.findUnique({ where: { id } });
    if(!existing){ send(res, 404, { ok:false, error:"الأوردر غير موجود" }); return; }
    if(existing.status === "returned"){ send(res, 409, { ok:false, error:"الأوردر مرتجع بالفعل" }); return; }
    if(existing.status === "cancelled"){ send(res, 409, { ok:false, error:"الأوردر ملغي بالفعل، لا يمكن تسجيله كمرتجع" }); return; }
    try{
      await prisma.$transaction(async function(tx){
        const fresh = await tx.order.findUnique({ where: { id } });
        if(!fresh) throw httpError(404, "الأوردر غير موجود");
        if(fresh.status === "returned") throw httpError(409, "الأوردر مرتجع بالفعل");
        if(fresh.status === "cancelled") throw httpError(409, "الأوردر ملغي بالفعل، لا يمكن تسجيله كمرتجع");
        const merged = { ...(fresh.data||{}), id: fresh.id, number: fresh.number, date: fresh.date?fresh.date.getTime():null,
          userId: fresh.userId, customerName: fresh.customerName, total: fresh.total, status: "returned" };
        await restoreOrderStockAndLedger(tx, id);
        await tx.order.update({ where: { id }, data: { status: "returned", data: merged } });
        await tx.auditLog.create({ data: auditEntry(req, "مرتجع أوردر", fresh.number || "") });
      }, { timeout: 30000 });
    }catch(err){
      if(err && err.httpStatus){ send(res, err.httpStatus, { ok:false, error: err.message }); return; }
      throw err;
    }
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  if(method === "POST" && /^\/api\/order\/[^/]+\/cancel$/.test(url)){
    const id = url.split("/")[3];
    const existing = await prisma.order.findUnique({ where: { id } });
    if(!existing){ send(res, 404, { ok:false, error:"الأوردر غير موجود" }); return; }
    if(existing.status === "cancelled"){ send(res, 409, { ok:false, error:"الأوردر ملغي بالفعل" }); return; }
    if(existing.status === "returned"){ send(res, 409, { ok:false, error:"الأوردر مرتجع بالفعل، لا يمكن إلغاؤه" }); return; }
    try{
      await prisma.$transaction(async function(tx){
        const fresh = await tx.order.findUnique({ where: { id } });
        if(!fresh) throw httpError(404, "الأوردر غير موجود");
        if(fresh.status === "cancelled") throw httpError(409, "الأوردر ملغي بالفعل");
        if(fresh.status === "returned") throw httpError(409, "الأوردر مرتجع بالفعل، لا يمكن إلغاؤه");
        const merged = { ...(fresh.data||{}), id: fresh.id, number: fresh.number, date: fresh.date?fresh.date.getTime():null,
          userId: fresh.userId, customerName: fresh.customerName, total: fresh.total, status: "cancelled" };
        await restoreOrderStockAndLedger(tx, id);
        await tx.order.update({ where: { id }, data: { status: "cancelled", data: merged } });
        await tx.auditLog.create({ data: auditEntry(req, "إلغاء أوردر", fresh.number || "") });
      }, { timeout: 30000 });
    }catch(err){
      if(err && err.httpStatus){ send(res, err.httpStatus, { ok:false, error: err.message }); return; }
      throw err;
    }
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }

  /* ---------- استبدال أوردر (مرآة لمنطق /api/returns exchange، لكن للأوردرات) ---------- */
  if(method === "POST" && /^\/api\/order\/[^/]+\/exchange$/.test(url)){
    const id = url.split("/")[3];
    const b = await readBody(req);
    const reqItems = Array.isArray(b.items) ? b.items : [];
    const reason = (b.reason||"").trim();
    const refundPartner = b.refundPartner === "abdo" ? "abdo" : (b.refundPartner === "moamen" ? "moamen" : null);

    if(!reqItems.length){ send(res, 400, {ok:false, error:"اختر صنفاً واحداً على الأقل للاستبدال"}); return; }

    const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
    if(!order){ send(res, 404, {ok:false, error:"الطلب غير موجود"}); return; }
    const exchangeableStatuses = ["new","preparing","ready","shipped","transit","delivered"];
    if(exchangeableStatuses.indexOf(order.status) === -1){ send(res, 400, {ok:false, error:"لا يمكن استبدال هذا الأوردر في حالته الحالية"}); return; }

    const exchangeId = uid();
    try{
      await prisma.$transaction(async function(tx){
        let returnedTotal = 0, replacementTotal = 0;
        const lineData = [];
        const requestedSoFar = {}; // orderItemId -> qty already staged within this same request

        for(const reqIt of reqItems){
          const qty = parseInt(reqIt.qty, 10) || 0;
          if(qty <= 0) throw httpError(400, "الكمية المرتجعة يجب أن تكون أكبر من صفر");

          const orderItem = order.items.find(function(oi){ return oi.id === reqIt.orderItemId; });
          if(!orderItem) throw httpError(400, "صنف غير موجود في هذا الأوردر");

          const agg = await tx.orderExchangeItem.aggregate({ where: { orderItemId: orderItem.id }, _sum: { qty: true } });
          const alreadyExchanged = (agg._sum.qty || 0) + (requestedSoFar[orderItem.id] || 0);
          const remainingQty = (orderItem.qty || 0) - alreadyExchanged;
          if(qty > remainingQty) throw httpError(400, "الكمية المطلوب استبدالها ("+qty+") أكبر من المتاح ("+remainingQty+")");
          requestedSoFar[orderItem.id] = (requestedSoFar[orderItem.id] || 0) + qty;

          const unitPrice = orderItem.price || 0;
          const lineTotal = unitPrice * qty;
          returnedTotal += lineTotal;

          const oiData = orderItem.data || {};
          const lineRec = {
            id: uid(), orderItemId: orderItem.id, productId: orderItem.productId||null, variantId: orderItem.variantId||null,
            size: oiData.size||null, color: oiData.color||null, qty: qty, unitPrice: unitPrice, lineTotal: lineTotal,
            replacementProductId: null, replacementVariantId: null, replacementQty: null, replacementPrice: null,
            data: reqIt
          };

          if(orderItem.variantId) await adjustVariantStock(tx, orderItem.variantId, qty);
          await recomputeProductStock(tx, orderItem.productId);

          if(reqIt.replacementVariantId){
            const repQty = parseInt(reqIt.replacementQty, 10) || 0;
            if(repQty <= 0) throw httpError(400, "كمية المنتج البديل يجب أن تكون أكبر من صفر");
            const repVariant = await tx.productVariant.findUnique({ where: { id: reqIt.replacementVariantId } });
            if(!repVariant) throw httpError(400, "المتغير البديل غير موجود");
            if((repVariant.stock||0) < repQty) throw httpError(400, "الكمية المتاحة من المنتج البديل غير كافية");
            const repProduct = await tx.product.findUnique({ where: { id: repVariant.productId } });
            const repPrice = (reqIt.replacementPrice != null) ? Number(reqIt.replacementPrice) : (repProduct ? (repProduct.price||0) : 0);
            replacementTotal += repPrice * repQty;

            lineRec.replacementProductId = repVariant.productId;
            lineRec.replacementVariantId = repVariant.id;
            lineRec.replacementQty = repQty;
            lineRec.replacementPrice = repPrice;

            await adjustVariantStock(tx, repVariant.id, -repQty);
            await recomputeProductStock(tx, repVariant.productId);
          }

          lineData.push(lineRec);
        }

        const difference = replacementTotal - returnedTotal;
        const fresh = await tx.order.findUnique({ where: { id } });
        const currentTotal = fresh.total || 0;
        const currentCollected = fresh.collectedTotal || 0;
        const newTotal = Math.max(0, currentTotal + difference);
        let newCollected = currentCollected;
        let refundAmount = 0;

        if(currentCollected > newTotal){
          refundAmount = currentCollected - newTotal;
          if(!refundPartner) throw httpError(400, "هذا الاستبدال يترتب عليه استرداد مبلغ للعميل — اختر الحساب (مؤمن/عبدو) اللي هيتحمّل الاسترداد");
          newCollected = newTotal;
        }
        const remaining = Math.max(0, newTotal - newCollected);
        const collectionStatus = remaining <= 0.004 ? "collected" : "pending";

        await tx.order.update({ where: { id }, data: { total: newTotal, collectedTotal: newCollected, remaining, collectionStatus, status: "exchanged" } });

        await tx.orderExchange.create({ data: {
          id: exchangeId, orderId: id, userId: user.id, date: new Date(), reason: reason || null,
          returnedTotal: returnedTotal, replacementTotal: replacementTotal, difference: difference,
          refundPartner: refundAmount>0 ? refundPartner : null, refundAmount: refundAmount>0 ? refundAmount : null,
          data: { reason },
          items: { create: lineData }
        }});

        if(refundAmount > 0){
          await upsertPartnerLedger(tx, { partner: refundPartner, type: "RETURN", direction: "out", amount: refundAmount,
            referenceType: "orderExchange", referenceId: exchangeId, date: Date.now(), userId: user.id,
            notes: "استرداد فرق استبدال — " + (fresh.number||"") });
        }

        await tx.auditLog.create({ data: auditEntry(req, "استبدال أوردر",
          (fresh.number||"") + " — الفرق " + difference + (refundAmount>0?(" — استرداد "+refundAmount):"")) });
      }, { timeout: 30000 });
    }catch(err){
      if(err && err.httpStatus){ send(res, err.httpStatus, { ok:false, error: err.message }); return; }
      throw err;
    }
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }

  /* ---------- المشتريات ---------- */
  if(method === "POST" && url === "/api/purchase"){
    const b = await readBody(req);
    const purchaseIn = b.purchase || {};
    const type = purchaseIn.type === "financial" ? "financial" : "goods";
    const increments = type === "financial" ? [] : (b.increments || []);
    const purchaseId = purchaseIn.id || uid();

    if(type === "financial"){
      if(!purchaseIn.supplierId){ send(res, 400, {ok:false, error:"المورد مطلوب"}); return; }
      if(!(Number(purchaseIn.total) > 0)){ send(res, 400, {ok:false, error:"إجمالي الفاتورة يجب أن يكون أكبر من صفر"}); return; }
    }
    const requestedInitialPaid = Math.max(0, Number(purchaseIn.paid) || 0);
    if(requestedInitialPaid > 0 && purchaseIn.partner !== "moamen" && purchaseIn.partner !== "abdo"){
      send(res, 400, {ok:false, error:"اختر الحساب (مؤمن/عبدو) للدفعة المبدئية"}); return;
    }

    try{
      await prisma.$transaction(async function(tx){
        const setting = await tx.setting.findUnique({ where: { id: 'main' } });
        const settings = (setting && setting.data) || {};

        purchaseIn.id = purchaseId;
        purchaseIn.date = Date.now();
        purchaseIn.userId = user.id;

        const requestedNumber = (purchaseIn.number || "").toString().trim();
        if(requestedNumber){
          const dupe = await tx.purchase.findFirst({ where: { supplierId: purchaseIn.supplierId || null, number: requestedNumber } });
          if(dupe) throw httpError(400, "رقم الفاتورة \""+requestedNumber+"\" مستخدم بالفعل لهذا المورد");
          purchaseIn.number = requestedNumber;
        } else {
          const counter = settings.purchaseCounter || 1001;
          purchaseIn.number = "PUR-" + counter;
          settings.purchaseCounter = counter + 1;
          await tx.setting.update({ where: { id: 'main' }, data: { purchaseCounter: settings.purchaseCounter, data: settings } });
        }

        let items = type === "financial" ? [] : (purchaseIn.items || []);
        let total = purchaseIn.total != null ? Number(purchaseIn.total) : 0;
        let paid = Math.max(0, Math.min(total, Number(purchaseIn.paid) || 0));
        let remaining = total - paid;
        let paymentStatus = (paid >= total && total > 0) ? "paid" : (paid > 0 ? "partial" : "unpaid");
        purchaseIn.type = type; purchaseIn.total = total; purchaseIn.paid = paid; purchaseIn.remaining = remaining; purchaseIn.paymentStatus = paymentStatus;

        await tx.purchase.create({ data: {
          id: purchaseIn.id, number: purchaseIn.number, date: new Date(purchaseIn.date), userId: purchaseIn.userId,
          supplierId: purchaseIn.supplierId || null, supplierName: purchaseIn.supplierName || null, total: total,
          type: type, paid: paid, remaining: remaining, paymentStatus: paymentStatus,
          paymentMethod: purchaseIn.paymentMethod || null, notes: (purchaseIn.notes||"").trim() || null, data: purchaseIn,
          items: { create: items.map(function(it){ return { id: uid(), productId: it.productId||null, variantId: it.variantId||null, qty: it.qty!=null?it.qty:null, cost: it.cost!=null?it.cost:null, data: it }; }) }
        }});

        for(const d of increments){
          await adjustVariantStock(tx, d.variantId, d.qty||0);
          if(d.productId){
            if(d.cost !== undefined && d.cost !== null) await tx.product.update({ where: { id: d.productId }, data: { cost: d.cost } });
            await recomputeProductStock(tx, d.productId);
          }
        }

        if(paid > 0 && purchaseIn.partner){
          const payId = uid();
          await tx.purchasePayment.create({ data: {
            id: payId, purchaseId: purchaseIn.id, supplierId: purchaseIn.supplierId||null, supplierName: purchaseIn.supplierName||null,
            date: new Date(purchaseIn.date), amount: paid, paymentMethod: purchaseIn.paymentMethod || null,
            notes: "دفعة مبدئية عند إنشاء الفاتورة", userId: user.id, partner: purchaseIn.partner, data: {}
          }});
          await upsertPartnerLedger(tx, { partner: purchaseIn.partner, type: "PURCHASE_PAYMENT", direction: "out", amount: paid,
            referenceType: "purchasePayment", referenceId: payId, date: purchaseIn.date, userId: user.id, notes: "دفعة مبدئية — " + purchaseIn.number });
        }

        await tx.auditLog.create({ data: auditEntry(req, type === "financial" ? "فاتورة مشتريات مالية" : "فاتورة شراء", purchaseIn.number + " — " + purchaseIn.supplierName + " — " + total + " " + (settings.currency||"")) });
      }, { timeout: 30000 });
    }catch(err){
      if(err && err.httpStatus){ send(res, err.httpStatus, { ok:false, error: err.message }); return; }
      throw err;
    }
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    const savedPurchase = state.purchases.find(function(p){ return p.id === purchaseId; });
    send(res, 200, { ok:true, db: state, purchase: savedPurchase });
    return;
  }
  if(method === "POST" && /^\/api\/purchase\/[^/]+\/payment$/.test(url)){
    const id = url.split("/")[3];
    const b = await readBody(req);
    const amount = Number(b.amount);
    const partner = b.partner === "abdo" ? "abdo" : (b.partner === "moamen" ? "moamen" : null);
    if(!(amount > 0)){ send(res, 400, {ok:false, error:"أدخل مبلغاً صحيحاً"}); return; }
    if(!partner){ send(res, 400, {ok:false, error:"اختر الحساب (مؤمن/عبدو)"}); return; }
    const purchase = await prisma.purchase.findUnique({ where: { id } });
    if(!purchase){ send(res, 404, {ok:false, error:"فاتورة الشراء غير موجودة"}); return; }

    const paymentId = uid();
    try{
      await prisma.$transaction(async function(tx){
        const fresh = await tx.purchase.findUnique({ where: { id } });
        const total = fresh.total || 0;
        const currentPaid = fresh.paid || 0;
        const newPaid = currentPaid + amount;
        if(newPaid > total + 0.004) throw httpError(400, "المبلغ المدفوع الإجمالي ("+newPaid+") يتجاوز إجمالي الفاتورة ("+total+")");
        const remaining = Math.max(0, total - newPaid);
        const paymentStatus = (newPaid >= total && total > 0) ? "paid" : (newPaid > 0 ? "partial" : "unpaid");

        await tx.purchase.update({ where: { id }, data: { paid: newPaid, remaining: remaining, paymentStatus: paymentStatus } });

        const payDate = Date.now();
        const pIt = { id: paymentId, purchaseId: id, supplierId: fresh.supplierId||null, supplierName: fresh.supplierName||null,
          date: payDate, amount: amount, paymentMethod: b.paymentMethod || "cash", notes: (b.notes||"").trim() || null, userId: user.id, partner: partner };
        await tx.purchasePayment.create({ data: {
          id: pIt.id, purchaseId: pIt.purchaseId, supplierId: pIt.supplierId, supplierName: pIt.supplierName,
          date: new Date(pIt.date), amount: pIt.amount, paymentMethod: pIt.paymentMethod, notes: pIt.notes, userId: pIt.userId, partner: pIt.partner, data: pIt
        }});

        await upsertPartnerLedger(tx, { partner, type: "PURCHASE_PAYMENT", direction: "out", amount,
          referenceType: "purchasePayment", referenceId: paymentId, date: payDate, userId: user.id, notes: "دفعة على فاتورة — " + (fresh.number||"") });

        await tx.auditLog.create({ data: auditEntry(req, "دفعة على فاتورة شراء", (fresh.number||"") + " — " + amount + " (" + (fresh.supplierName||"") + ")") });
      }, { timeout: 30000 });
    }catch(err){
      if(err && err.httpStatus){ send(res, err.httpStatus, { ok:false, error: err.message }); return; }
      throw err;
    }
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  if(method === "POST" && /^\/api\/purchase\/[^/]+\/edit$/.test(url)){
    const id = url.split("/")[3];
    const b = await readBody(req);
    const existing = await prisma.purchase.findUnique({ where: { id } });
    if(!existing){ send(res, 404, {ok:false, error:"فاتورة الشراء غير موجودة"}); return; }

    try{
      await prisma.$transaction(async function(tx){
        const data = {
          supplierId: b.supplierId !== undefined ? (b.supplierId||null) : existing.supplierId,
          supplierName: b.supplierName !== undefined ? (b.supplierName||null) : existing.supplierName,
          date: b.date ? new Date(b.date) : existing.date,
          number: (b.number !== undefined && String(b.number).trim()) ? String(b.number).trim() : existing.number,
          notes: b.notes !== undefined ? ((b.notes||"").trim()||null) : existing.notes,
          paymentMethod: b.paymentMethod !== undefined ? (b.paymentMethod||null) : existing.paymentMethod
        };

        if(existing.type === "financial" && b.total !== undefined){
          const total = Number(b.total);
          if(!(total > 0)) throw httpError(400, "إجمالي الفاتورة يجب أن يكون أكبر من صفر");
          const alreadyPaid = existing.paid || 0;
          if(total < alreadyPaid - 0.004){
            throw httpError(400, "لا يمكن تقليل إجمالي الفاتورة إلى ("+total+") لأن المبلغ المدفوع بالفعل ("+alreadyPaid+") أكبر من ذلك — قم بتصحيح/استرداد الدفعة أولاً قبل تقليل الإجمالي");
          }
          data.total = total;
          data.paid = alreadyPaid;
          data.remaining = total - alreadyPaid;
          data.paymentStatus = (alreadyPaid >= total) ? "paid" : (alreadyPaid > 0 ? "partial" : "unpaid");
        }

        if(data.number !== existing.number){
          const dupe = await tx.purchase.findFirst({ where: { supplierId: data.supplierId||null, number: data.number, NOT: { id } } });
          if(dupe) throw httpError(400, "رقم الفاتورة \""+data.number+"\" مستخدم بالفعل لهذا المورد");
        }

        await tx.purchase.update({ where: { id }, data });
        await tx.auditLog.create({ data: auditEntry(req, "تعديل فاتورة شراء", data.number || "") });
      }, { timeout: 30000 });
    }catch(err){
      if(err && err.httpStatus){ send(res, err.httpStatus, { ok:false, error: err.message }); return; }
      throw err;
    }
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  if(method === "POST" && /^\/api\/purchase\/[^/]+\/delete$/.test(url)){
    const id = url.split("/")[3];
    const existing = await prisma.purchase.findUnique({ where: { id }, include: { items: true } });
    if(!existing){ send(res, 404, {ok:false}); return; }
    try{
      await prisma.$transaction(async function(tx){
        for(const it of existing.items){
          await adjustVariantStock(tx, it.variantId, -(it.qty||0));
          await recomputeProductStock(tx, it.productId);
        }
        await tx.purchase.delete({ where: { id } });
        await tx.auditLog.create({ data: auditEntry(req, "حذف فاتورة شراء", existing.number || "") });
      }, { timeout: 30000 });
    }catch(err){
      if(err && err.code === "P2003"){ send(res, 400, {ok:false, error:"لا يمكن حذف هذه الفاتورة لوجود دفعات مسجّلة عليها"}); return; }
      throw err;
    }
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }

  /* ---------- الديون اليدوية ---------- */
  if(method === "POST" && url === "/api/debts"){
    const b = await readBody(req);
    const debtIn = b.item || {};
    const debtId = debtIn.id || uid();
    try{
      await prisma.$transaction(async function(tx){
        const normalized = buildDebtPayload(debtIn, user.id);
        const debtData = { id: debtId, ...normalized };
        await tx.debt.create({ data: {
          id: debtId, type: normalized.type, entityType: normalized.entityType, entityId: normalized.entityId,
          personName: normalized.personName, totalAmount: normalized.totalAmount, paidAmount: 0, remainingAmount: normalized.totalAmount,
          status: "unpaid", date: new Date(normalized.date), paymentMethod: normalized.paymentMethod, notes: normalized.notes,
          partner: normalized.partner, direction: normalized.direction, userId: user.id, data: debtData
        }});
        if(normalized.paidAmount > 0){
          // مين دفع الدفعة المبدئية: لو الدين "لنا" (دائن عميل) فالدافع هو نفس
          // العميل المرتبط بالدين تلقائياً؛ ولو "علينا" فلازم الواجهة تبعت
          // partner (مؤمن/عبدو) — نفس منطق buildDebtPaymentPayload بالظبط.
          const freshDebt = { id: debtId, totalAmount: normalized.totalAmount, paidAmount: 0, direction: normalized.direction, personName: normalized.personName };
          const payload = await buildDebtPaymentPayload(tx, freshDebt, {
            amount: normalized.paidAmount, date: normalized.date, paymentMethod: normalized.paymentMethod,
            notes: "دفعة مبدئية عند إنشاء الدين",
            partner: debtIn.partner || normalized.partner,
            payerId: normalized.direction === "in" ? normalized.entityId : debtIn.payerId
          });
          await createDebtPayment(tx, { debt: freshDebt, payload, userId: user.id });
        }
        await tx.auditLog.create({ data: auditEntry(req, "إضافة دين", (normalized.personName || normalized.entityId || "") + " — " + normalized.totalAmount) });
      }, { timeout: 30000 });
    }catch(err){
      if(err && err.httpStatus){ send(res, err.httpStatus, { ok:false, error: err.message }); return; }
      throw err;
    }
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    const savedDebt = state.debts.find(function(d){ return d.id === debtId; });
    send(res, 200, { ok:true, db: state, debt: savedDebt });
    return;
  }
  if(method === "POST" && /^\/api\/debts\/[^/]+\/edit$/.test(url)){
    const id = url.split("/")[3];
    const b = await readBody(req);
    const existing = await prisma.debt.findUnique({ where: { id } });
    if(!existing){ send(res, 404, { ok:false, error:"الدين غير موجود" }); return; }
    try{
      await prisma.$transaction(async function(tx){
        const normalized = buildDebtPayload({
          type: b.type !== undefined ? b.type : existing.type,
          entityId: b.entityId !== undefined ? b.entityId : existing.entityId,
          personName: b.personName !== undefined ? b.personName : existing.personName,
          totalAmount: b.totalAmount !== undefined ? b.totalAmount : existing.totalAmount,
          paidAmount: existing.paidAmount || 0,
          date: b.date !== undefined ? b.date : (existing.date ? existing.date.getTime() : Date.now()),
          paymentMethod: b.paymentMethod !== undefined ? b.paymentMethod : existing.paymentMethod,
          notes: b.notes !== undefined ? b.notes : existing.notes,
          partner: b.partner !== undefined ? b.partner : existing.partner
        }, existing.userId || user.id);
        if(normalized.totalAmount < (existing.paidAmount || 0) - 0.004){
          throw httpError(400, "لا يمكن أن يكون إجمالي الدين أقل من المبلغ المدفوع.");
        }
        const debtData = { ...(existing.data || {}), id, ...normalized, paidAmount: existing.paidAmount || 0, remainingAmount: Math.max(0, normalized.totalAmount - (existing.paidAmount || 0)), status: debtStatusFromAmounts(normalized.totalAmount, existing.paidAmount || 0) };
        await tx.debt.update({ where: { id }, data: {
          type: normalized.type, entityType: normalized.entityType, entityId: normalized.entityId, personName: normalized.personName,
          totalAmount: normalized.totalAmount, remainingAmount: debtData.remainingAmount, status: debtData.status,
          date: new Date(normalized.date), paymentMethod: normalized.paymentMethod, notes: normalized.notes,
          partner: normalized.partner, direction: normalized.direction, data: debtData
        }});
        await tx.auditLog.create({ data: auditEntry(req, "تعديل دين", normalized.personName || id) });
      }, { timeout: 30000 });
    }catch(err){
      if(err && err.httpStatus){ send(res, err.httpStatus, { ok:false, error: err.message }); return; }
      throw err;
    }
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  if(method === "POST" && /^\/api\/debts\/[^/]+\/payment$/.test(url)){
    const id = url.split("/")[3];
    const b = await readBody(req);
    const existing = await prisma.debt.findUnique({ where: { id } });
    if(!existing){ send(res, 404, { ok:false, error:"الدين غير موجود" }); return; }
    try{
      await prisma.$transaction(async function(tx){
        const fresh = await tx.debt.findUnique({ where: { id } });
        const payload = await buildDebtPaymentPayload(tx, fresh, b);
        await createDebtPayment(tx, { debt: fresh, payload, userId: user.id });
        await tx.auditLog.create({ data: auditEntry(req, "دفعة على دين", (fresh.personName || fresh.id) + " — " + payload.amount + " — " + payload.payerName) });
      }, { timeout: 30000 });
    }catch(err){
      if(err && err.httpStatus){ send(res, err.httpStatus, { ok:false, error: err.message }); return; }
      throw err;
    }
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  if(method === "POST" && /^\/api\/debts\/[^/]+\/payments\/[^/]+\/edit$/.test(url)){
    const parts = url.split("/"); // "", "api", "debts", debtId, "payments", paymentId, "edit"
    const debtId = parts[3], paymentId = parts[5];
    const b = await readBody(req);
    const existingPayment = await prisma.debtPayment.findUnique({ where: { id: paymentId } });
    if(!existingPayment || existingPayment.debtId !== debtId){ send(res, 404, { ok:false, error:"الدفعة غير موجودة" }); return; }
    try{
      await prisma.$transaction(async function(tx){
        const debt = await tx.debt.findUnique({ where: { id: debtId } });
        if(!debt) throw httpError(404, "الدين غير موجود");
        // نعكس أثر الدفعة القديمة على دفتر الشركاء الأول، قبل أي تحقق من القيمة
        // الجديدة — لو التحقق فشل بعد كده، الـ transaction كله بيترجع زي ما كان.
        await deletePartnerLedgerFor(tx, "debtPayment", paymentId);
        const agg = await tx.debtPayment.aggregate({ where: { debtId, NOT: { id: paymentId } }, _sum: { amount: true } });
        const otherPaid = agg._sum.amount || 0;
        const payload = await buildDebtPaymentPayload(tx, debt, b, otherPaid);
        const now = new Date();
        await tx.debtPayment.update({ where: { id: paymentId }, data: {
          amount: payload.amount, date: new Date(payload.date), paymentMethod: payload.paymentMethod, notes: payload.notes,
          partner: payload.partner, payerType: payload.payerType, payerId: payload.payerId, payerName: payload.payerName,
          direction: payload.direction, updatedAt: now,
          data: {
            ...(existingPayment.data || {}), amount: payload.amount, date: payload.date, paymentMethod: payload.paymentMethod,
            notes: payload.notes, partner: payload.partner, payerType: payload.payerType, payerId: payload.payerId,
            payerName: payload.payerName, direction: payload.direction
          }
        }});
        if(payload.partner === "moamen" || payload.partner === "abdo"){
          await upsertPartnerLedger(tx, {
            partner: payload.partner, type: "DEBT_PAYMENT", direction: payload.direction || "out", amount: payload.amount,
            referenceType: "debtPayment", referenceId: paymentId, date: payload.date, userId: existingPayment.userId || user.id,
            notes: "دفعة دين (معدّلة) — " + (debt.personName || debt.id)
          });
        }
        await recomputeDebtTotals(tx, debtId);
        await tx.auditLog.create({ data: auditEntry(req, "تعديل دفعة دين", (debt.personName || debtId) + " — " + payload.amount + " — " + payload.payerName) });
      }, { timeout: 30000 });
    }catch(err){
      if(err && err.httpStatus){ send(res, err.httpStatus, { ok:false, error: err.message }); return; }
      throw err;
    }
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  if(method === "POST" && /^\/api\/debts\/[^/]+\/payments\/[^/]+\/delete$/.test(url)){
    const parts = url.split("/");
    const debtId = parts[3], paymentId = parts[5];
    const existingPayment = await prisma.debtPayment.findUnique({ where: { id: paymentId } });
    if(!existingPayment || existingPayment.debtId !== debtId){ send(res, 404, { ok:false, error:"الدفعة غير موجودة" }); return; }
    const debt = await prisma.debt.findUnique({ where: { id: debtId } });
    await prisma.$transaction(async function(tx){
      await deletePartnerLedgerFor(tx, "debtPayment", paymentId);
      await tx.debtPayment.delete({ where: { id: paymentId } });
      await recomputeDebtTotals(tx, debtId);
      await tx.auditLog.create({ data: auditEntry(req, "حذف دفعة دين", (debt ? (debt.personName || debtId) : debtId) + " — " + existingPayment.amount) });
    }, { timeout: 30000 });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  if(method === "POST" && /^\/api\/debts\/[^/]+\/delete$/.test(url)){
    const id = url.split("/")[3];
    const existing = await prisma.debt.findUnique({ where: { id } });
    if(!existing){ send(res, 404, { ok:false, error:"الدين غير موجود" }); return; }
    await prisma.$transaction(async function(tx){
      await reverseDebtLedger(tx, id);
      await tx.debtPayment.deleteMany({ where: { debtId: id } });
      await tx.debt.delete({ where: { id } });
      await tx.auditLog.create({ data: auditEntry(req, "حذف دين", existing.personName || id) });
    }, { timeout: 30000 });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }

  /* ---------- عمليات عامة (إضافة/تعديل/حذف) ---------- */
  for(const g of Object.keys(genericModels)){
    const cfg = genericModels[g];
    if(method === "POST" && url === "/api/" + g){
      const b = await readBody(req);
      const it = b.item || {};
      const existing = it.id ? await cfg.findOne(it.id) : null;
      const isNew = !existing;
      it.id = it.id || uid();
      if(g === "products"){
        const modelCode = (it.modelCode||"").trim();
        if(!modelCode){ send(res, 400, {ok:false, error:"كود الموديل مطلوب"}); return; }
        it.modelCode = modelCode;
        const dupe = await prisma.product.findFirst({ where: { modelCode } });
        if(dupe && dupe.id !== it.id){ send(res, 400, {ok:false, error:"كود الموديل \""+modelCode+"\" مستخدم بالفعل لمنتج آخر"}); return; }
      }
      if(g === "expenses" || g === "income"){
        if(it.partner !== "moamen" && it.partner !== "abdo"){ send(res, 400, {ok:false, error:"اختر الحساب (مؤمن/عبدو)"}); return; }
      }
      try{
        await prisma.$transaction(async function(tx){
          await cfg.upsert(tx, it, isNew);
          if(g === "expenses"){
            await upsertPartnerLedger(tx, { partner: it.partner, type: "EXPENSE", direction: "out", amount: it.amount,
              referenceType: "expense", referenceId: it.id, date: it.date, userId: it.userId || user.id, notes: it.note || null });
          } else if(g === "income"){
            await upsertPartnerLedger(tx, { partner: it.partner, type: "OTHER_INCOME", direction: "in", amount: it.amount,
              referenceType: "otherIncome", referenceId: it.id, date: it.date, userId: it.userId || user.id, notes: it.note || null });
          }
          await tx.auditLog.create({ data: auditEntry(req, isNew ? cfg.addLabel : cfg.editLabel, cfg.logDetail(it)) });
        }, { timeout: 30000 });
      }catch(err){
        if(g === "products" && err && err.code === "P2002"){ send(res, 400, {ok:false, error:"كود الموديل مستخدم بالفعل لمنتج آخر"}); return; }
        throw err;
      }
      await db.trimAuditLog();
      const state = await db.buildStateFromDB();
      send(res, 200, { ok:true, db: state, item: it });
      return;
    }
    if(method === "POST" && /^\/api\/[^/]+\/[^/]+\/delete$/.test(url) && url.indexOf("/api/" + g + "/") === 0){
      const id = url.split("/")[3];
      const existing = await cfg.findOne(id);
      if(!existing){ send(res, 404, {ok:false}); return; }
      if(g === "users"){
        if(existing.id === user.id){ send(res, 400, {ok:false, error:"لا يمكنك حذف حسابك الحالي"}); return; }
        if(existing.role === "admin"){
          const adminCount = await prisma.user.count({ where: { role: "admin" } });
          if(adminCount <= 1){ send(res, 400, {ok:false, error:"لا يمكن حذف آخر مدير"}); return; }
        }
      }
      await prisma.$transaction(async function(tx){
        await cfg.remove(tx, id);
        if(g === "expenses") await deletePartnerLedgerFor(tx, "expense", id);
        if(g === "income") await deletePartnerLedgerFor(tx, "otherIncome", id);
        await tx.auditLog.create({ data: auditEntry(req, cfg.delLabel, cfg.logDetail(existing)) });
      }, { timeout: 30000 });
      await db.trimAuditLog();
      const state = await db.buildStateFromDB();
      send(res, 200, { ok:true, db: state });
      return;
    }
  }

  // مخزون منتج (تعديل كميات المقاسات)
  if(method === "POST" && /^\/api\/products\/[^/]+\/stock$/.test(url)){
    const b = await readBody(req);
    const id = url.split("/")[3];
    const product = await prisma.product.findUnique({ where: { id } });
    if(!product){ send(res, 404, {ok:false}); return; }
    await prisma.$transaction(async function(tx){
      for(const v of (b.variants||[])){
        const stock = Math.max(0, parseInt(v.stock,10)||0);
        await tx.productVariant.updateMany({ where: { id: v.id, productId: id }, data: { stock } });
      }
      await recomputeProductStock(tx, id);
      await tx.auditLog.create({ data: auditEntry(req, "تعديل مخزون", product.name) });
    }, { timeout: 30000 });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }

  // الفئات (منتجات ومصاريف)
  if(method === "POST" && url === "/api/categories"){
    const b = await readBody(req);
    await prisma.$transaction(async function(tx){
      if(b.action === "add"){
        const existing = await tx.category.findUnique({ where: { name: b.name } });
        if(!existing) await tx.category.create({ data: { id: uid(), name: b.name } });
        await tx.auditLog.create({ data: auditEntry(req, "إضافة فئة", b.name) });
      } else {
        await tx.category.deleteMany({ where: { name: b.name } });
        await tx.auditLog.create({ data: auditEntry(req, "حذف فئة", b.name) });
      }
    });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  if(method === "POST" && url === "/api/expense-categories"){
    const b = await readBody(req);
    await prisma.$transaction(async function(tx){
      if(b.action === "add"){
        const existing = await tx.expenseCategory.findUnique({ where: { name: b.name } });
        if(!existing) await tx.expenseCategory.create({ data: { id: uid(), name: b.name } });
      } else {
        await tx.expenseCategory.deleteMany({ where: { name: b.name } });
      }
    });
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  if(method === "POST" && url === "/api/shipping-companies"){
    const b = await readBody(req);
    await prisma.$transaction(async function(tx){
      if(b.action === "add"){
        await tx.shippingCompany.create({ data: { id: uid(), name: b.name, phone:"", notes:"" } });
      } else {
        await tx.shippingCompany.deleteMany({ where: { id: b.id } });
      }
    });
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  if(method === "POST" && url === "/api/ship-prices"){
    const b = await readBody(req);
    await prisma.$transaction(async function(tx){
      for(const s of (b.prices||[])){
        await tx.shippingPrice.updateMany({ where: { id: s.id }, data: { price: s.price } });
      }
      await tx.auditLog.create({ data: auditEntry(req, "تحديث أسعار الشحن") });
    });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }

  // الدفعات والتحويلات والإقفالات
  if(method === "POST" && url === "/api/payments/in"){
    const b = await readBody(req);
    const it = b.item || {};
    it.id = it.id || uid();
    it.date = Date.now();
    it.userId = user.id;
    await prisma.$transaction(async function(tx){
      await tx.paymentIn.create({ data: { id: it.id, customerName: it.customerName || null, amount: it.amount != null ? it.amount : null, date: new Date(it.date), userId: it.userId, data: it } });
      await tx.auditLog.create({ data: auditEntry(req, "قبض دفعة من عميل", it.customerName + " — " + it.amount) });
    });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  if(method === "POST" && url === "/api/payments/out"){
    const b = await readBody(req);
    const it = b.item || {};
    if(!(Number(it.amount) > 0)){ send(res, 400, {ok:false, error:"أدخل مبلغاً صحيحاً"}); return; }
    if(it.partner !== "moamen" && it.partner !== "abdo"){ send(res, 400, {ok:false, error:"اختر الحساب (مؤمن/عبدو)"}); return; }
    it.id = it.id || uid();
    it.date = Date.now();
    it.userId = user.id;
    await prisma.$transaction(async function(tx){
      await tx.paymentOut.create({ data: { id: it.id, supplierName: it.supplierName || null, amount: it.amount != null ? it.amount : null, date: new Date(it.date), userId: it.userId, partner: it.partner, data: it } });
      await upsertPartnerLedger(tx, { partner: it.partner, type: "PURCHASE_PAYMENT", direction: "out", amount: it.amount,
        referenceType: "paymentOut", referenceId: it.id, date: it.date, userId: it.userId, notes: "دفعة للمورد — " + (it.supplierName||"") });
      await tx.auditLog.create({ data: auditEntry(req, "دفع للمورد", it.supplierName + " — " + it.amount) });
    });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  if(method === "POST" && url === "/api/transfers"){
    const b = await readBody(req);
    const it = b.item || {};
    it.id = it.id || uid();
    it.date = Date.now();
    it.byId = user.id;
    const f = it.fromId ? await prisma.user.findUnique({ where: { id: it.fromId } }) : null;
    const t = it.toId ? await prisma.user.findUnique({ where: { id: it.toId } }) : null;
    await prisma.$transaction(async function(tx){
      await tx.transfer.create({ data: { id: it.id, fromId: it.fromId || null, toId: it.toId || null, amount: it.amount != null ? it.amount : null, date: new Date(it.date), byId: it.byId } });
      const settingRow = await tx.setting.findUnique({ where: { id: 'main' } });
      const currency = (settingRow && settingRow.data && settingRow.data.currency) || (settingRow ? settingRow.currency : "") || "";
      await tx.auditLog.create({ data: auditEntry(req, "تحويل فلوس", (f?f.name:"") + " ← " + (t?t.name:"") + " — " + it.amount + " " + currency) });
    });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  if(method === "POST" && url === "/api/closings"){
    const b = await readBody(req);
    const it = b.item || {};
    await prisma.$transaction(async function(tx){
      const prev = await tx.cashClosing.findFirst({ where: { userId: it.userId || null, day: it.day || null } });
      if(prev){
        const merged = { ...(prev.data||{}), ...it };
        await tx.cashClosing.update({ where: { id: prev.id }, data: { data: merged } });
      } else {
        it.id = it.id || uid();
        it.date = Date.now();
        await tx.cashClosing.create({ data: { id: it.id, userId: it.userId || null, day: it.day || null, date: new Date(it.date), data: it } });
      }
      await tx.auditLog.create({ data: auditEntry(req, "إقفال خزنة", it.userName || "") });
    }, { timeout: 30000 });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }

  // الإعدادات
  if(method === "POST" && url === "/api/settings"){
    const b = await readBody(req);
    await prisma.$transaction(async function(tx){
      const setting = await tx.setting.findUnique({ where: { id: 'main' } });
      const merged = { ...((setting && setting.data) || {}), ...(b.settings || {}) };
      const cols = {
        storeName: merged.storeName || null, currency: merged.currency || null, taxRate: merged.taxRate != null ? merged.taxRate : null,
        lowStockThreshold: merged.lowStockThreshold != null ? merged.lowStockThreshold : null, invoicePrefix: merged.invoicePrefix || null,
        invoiceCounter: merged.invoiceCounter != null ? merged.invoiceCounter : null, purchaseCounter: merged.purchaseCounter != null ? merged.purchaseCounter : null,
        orderCounter: merged.orderCounter != null ? merged.orderCounter : null, receiptFooter: merged.receiptFooter || null, phone: merged.phone || null,
        data: merged
      };
      await tx.setting.upsert({ where: { id: 'main' }, update: cols, create: { id: 'main', ...cols } });
      await tx.auditLog.create({ data: auditEntry(req, "تحديث الإعدادات") });
    });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }

  // نسخ احتياطي / استيراد / تصفير
  if(method === "POST" && url === "/api/reset"){
    await db.replaceStateInDB(seed());
    await prisma.auditLog.create({ data: auditEntry(req, "مسح كل البيانات") });
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  if(method === "POST" && url === "/api/import"){
    const b = await readBody(req);
    if(!b.db || !b.db.settings || !b.db.products){ send(res, 400, {ok:false, error:"ملف غير صالح"}); return; }
    await db.replaceStateInDB(b.db);
    await prisma.auditLog.create({ data: auditEntry(req, "استيراد بيانات") });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }

  send(res, 404, { ok:false, error: "مسار غير معروف" });
 } catch(err){
   console.error("Request error:", err);
   if(!res.headersSent){
     try { send(res, 500, { ok:false, error: "خطأ في الخادم" }); } catch(e){ /* noop */ }
   }
 }
});

server.on("error", function(err){
  console.error("FATAL: server failed to start listening:", err);
  process.exit(1);
});

// شبكة أمان: أي خطأ غير متوقع (زي فشل مؤقت في تهيئة قاعدة البيانات) يتسجل
// بوضوح بدل ما يوقف العملية كلها ويخلي Railway يعمل restart loop لا نهائي.
// دي مش ممارسة عامة موصى بيها لكل تطبيق، لكنها مطلوبة هنا تحديداً عشان
// نضمن إن فشل السيد (seed) وحده مايكسرش الكونتينر.
process.on("unhandledRejection", function(err){
  console.error("Unhandled promise rejection (server continues running):", err);
});
process.on("uncaughtException", function(err){
  console.error("Uncaught exception (server continues running):", err);
});

// السيرفر لازم يفتح البورت فوراً عشان health check بتاع Railway ينجح،
// من غير ما يستنى قاعدة البيانات. تهيئة قاعدة البيانات (فحص الاتصال + السيد
// لو القاعدة فاضية + التحقق من الأعداد) بتتم بعد كده وبينتظرها قبل ما نعتبر
// السيرفر "جاهز" — لكن لو فشلت، بتتسجل بوضوح والسيرفر يفضل شغال، وأي طلب
// محتاج قاعدة بيانات هيرجع خطأ مناسب لحد ما الاتصال يتظبط.
server.listen(PORT, "0.0.0.0", function(){
  console.log("Server running on port " + PORT + " | Database: PostgreSQL via Prisma");

  db.initializeDatabase(seed())
    .then(function(){
      console.log("Server ready.");
    })
    .catch(function(err){
      console.error("Database initialization failed:", err);
    });
});
