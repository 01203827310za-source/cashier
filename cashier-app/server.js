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
  return prisma.user.findUnique({ where: { id: userId }, include: { permissions: true } });
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

function httpError(status, message){ const e = new Error(message); e.httpStatus = status; return e; }

/* ---------- نظام الصلاحيات الدقيقة (صفحة + إجراء) ----------
   مصدر الحقيقة الوحيد لأي تحقق صلاحية في السيرفر كله. المدير (role==="admin")
   بيعدّي أي تحقق دايمًا (مينفعش يقفل على نفسه صفحة المستخدمين بالغلط). أي
   مستخدم كاشير لسه معندوش أي صف UserPermission (يعني اتعمله seed أو اتضاف قبل
   ما النظام ده يتعمل) بيرجعله نفس الصلاحيات اللي كانت شغالة فعليًا قبل كده
   (nav roles + canManageReturns) — عشان النشر مايقفلش على أي حد فجأة. أول ما
   المدير يحفظ صلاحيات صريحة لمستخدم، الـ fallback بيوقف له وبقى صفوف
   UserPermission هي المصدر الوحيد. */
const LEGACY_CASHIER_MODULES = {
  dashboard: ["view"],
  pos: ["view", "create", "edit"],
  products: ["view", "create", "edit"],
  orders: ["view", "create", "edit"],
  reports: ["view"]
};
function legacyCan(user, module, action){
  if(module === "returns" && (action === "return" || action === "exchange" || action === "cancel")){
    return user.canManageReturns !== false;
  }
  const allowed = LEGACY_CASHIER_MODULES[module];
  return !!allowed && allowed.indexOf(action) !== -1;
}
function can(user, module, action){
  if(!user) return false;
  if(user.role === "admin") return true;
  const perms = user.permissions || [];
  if(!perms.length) return legacyCan(user, module, action);
  return perms.some(function(p){ return p.module === module && p.action === action; });
}
const PERMISSION_DENIED = "ليس لديك صلاحية للقيام بهذا الإجراء";
// جدول الطرق اللي محددة بالكامل من method+url وحدهم (من غير الحاجة لقراءة الـ
// body) — بيتفحص مرة واحدة بعد بوابة تسجيل الدخول مباشرة. الطرق اللي محتاجة
// تفرّق بين create/edit أو نوع العملية من جوه الـ body (المنتجات/العملاء/
// المصاريف/المستخدمين، و/api/returns) بتتفحص بمكانها جوه الكود نفسه بدل الجدول ده.
const ROUTE_PERMISSIONS = [
  { method:"POST", pattern:/^\/api\/sale$/, module:"pos", action:"create" },
  { method:"POST", pattern:/^\/api\/sale\/[^/]+\/cancel$/, module:"pos", action:"cancel" },
  { method:"POST", pattern:/^\/api\/sale\/[^/]+\/return$/, module:"pos", action:"cancel" },

  { method:"POST", pattern:/^\/api\/products\/[^/]+\/stock$/, module:"products", action:"edit" },
  { method:"POST", pattern:/^\/api\/printing-orders$/, module:"products", action:"edit" },
  { method:"POST", pattern:/^\/api\/printing-orders\/[^/]+\/cancel$/, module:"products", action:"edit" },
  { method:"POST", pattern:/^\/api\/categories$/, module:"products", action:"edit" },

  { method:"POST", pattern:/^\/api\/order$/, module:"orders", action:"create" },
  { method:"POST", pattern:/^\/api\/order\/[^/]+\/status$/, module:"orders", action:"edit" },
  { method:"POST", pattern:/^\/api\/order\/[^/]+\/shipment$/, module:"orders", action:"edit" },
  { method:"POST", pattern:/^\/api\/order\/[^/]+\/exchange$/, module:"orders", action:"edit" },
  { method:"POST", pattern:/^\/api\/order\/[^/]+\/collection$/, module:"orders", action:"collect" },
  { method:"POST", pattern:/^\/api\/order\/[^/]+\/cod$/, module:"orders", action:"collect" },
  { method:"POST", pattern:/^\/api\/order\/[^/]+\/cancel$/, module:"orders", action:"cancel" },
  { method:"POST", pattern:/^\/api\/order\/[^/]+\/return$/, module:"orders", action:"cancel" },
  { method:"POST", pattern:/^\/api\/shipping-companies$/, module:"orders", action:"edit" },
  { method:"POST", pattern:/^\/api\/ship-prices$/, module:"orders", action:"edit" },

  { method:"POST", pattern:/^\/api\/returns\/[^/]+\/cancel$/, module:"returns", action:"cancel" },

  { method:"POST", pattern:/^\/api\/expense-categories$/, module:"expenses", action:"edit" },

  { method:"POST", pattern:/^\/api\/debt-accounts$/, module:"debts", action:"create" },
  { method:"POST", pattern:/^\/api\/debt-accounts\/[^/]+\/invoices$/, module:"debts", action:"create" },
  { method:"POST", pattern:/^\/api\/debt-accounts\/[^/]+\/invoices\/[^/]+\/edit$/, module:"debts", action:"edit" },
  { method:"POST", pattern:/^\/api\/debt-accounts\/[^/]+\/invoices\/[^/]+\/delete$/, module:"debts", action:"delete" },
  { method:"POST", pattern:/^\/api\/debt-accounts\/[^/]+\/payments$/, module:"debts", action:"payment" },
  { method:"POST", pattern:/^\/api\/debt-accounts\/[^/]+\/payments\/[^/]+\/edit$/, module:"debts", action:"payment" },
  { method:"POST", pattern:/^\/api\/debt-accounts\/[^/]+\/payments\/[^/]+\/delete$/, module:"debts", action:"payment" },

  { method:"POST", pattern:/^\/api\/transfers$/, module:"cash", action:"create" },
  { method:"POST", pattern:/^\/api\/closings$/, module:"cash", action:"edit" },

  { method:"POST", pattern:/^\/api\/partners\/ledger$/, module:"partners", action:"create" },
  { method:"POST", pattern:/^\/api\/partners\/ledger\/[^/]+\/delete$/, module:"partners", action:"delete" }
];
function checkRoutePermission(user, method, url){
  const rule = ROUTE_PERMISSIONS.find(function(r){ return r.method === method && r.pattern.test(url); });
  if(!rule) return null; // مفيش قاعدة لطريق زي ده — التحقق بيتم جوه الكود نفسه (أو الطريق مش محكوم أصلًا)
  return can(user, rule.module, rule.action);
}

/* ---------- سجل حسابات الشركاء (مؤمن/عبدو) — المصدر الوحيد لحساب الأرصدة ----------
   referenceType/referenceId يحدّدان الحركة المالية الأصلية بشكل فريد (فاتورة بيع،
   دفعة شراء بعينها، دفعة تحصيل أوردر بعينها، مصروف، إيراد...). الحذف-ثم-الإنشاء
   يجعل التعديل (لمصروف/إيراد له نفس id) آمناً بدون تكرار أو قيود قديمة عالقة. */
async function upsertPartnerLedger(tx, opts){
  if(!opts.referenceType || !opts.referenceId) return;
  await tx.partnerTransaction.deleteMany({ where: { referenceType: opts.referenceType, referenceId: opts.referenceId } });
  if(normalizePartner(opts.partner) && Number(opts.amount) > 0){
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
const PARTNER_LABELS = { moamen: "مؤمن", abdo: "عبدو", mido: "ميدو" };
const PARTNER_IDS = ["moamen", "abdo", "mido"];
// أي مكان بياخد partner من الـ body لازم يمرّ من هنا — بيرجّع القيمة نفسها لو
// كانت واحدة من الشركاء التلاتة الحقيقيين، وإلا null (يشمل الحالة الفاضية/
// "shared" الخاصة بمصروف/إيراد المحل المشترك اللي مش لازم يتخصم من حد بعينه).
function normalizePartner(v){ return PARTNER_IDS.indexOf(v) !== -1 ? v : null; }
const PARTNER_MANUAL_TYPE_LABELS = {
  OPENING_BALANCE: "رصيد افتتاحي", MANUAL_ADD: "مبلغ مُضاف", OTHER_DUE: "مستحقات أخرى",
  WITHDRAWAL: "مسحوبات", DEDUCTION: "خصم/تسوية", PARTNER_TRANSFER: "تحويل/تسوية خارجة"
};
function ledgerManualLabel(type){ return PARTNER_MANUAL_TYPE_LABELS[type] || type; }
// نظام حسابات الأشخاص للديون: حساب واحد لكل اسم شخص (مطابقة على الاسم بعد trim،
// case-insensitive)، تحته أي عدد من الفواتير، وتحت كل فاتورة أو الحساب مباشرة
// أي عدد من الدفعات. مفيش نوع دين ولا اعتماد على Customer/Supplier، وكل دفعة
// لازم تتربط بحساب شريك حقيقي (مؤمن/عبدو) لأن كل دين هنا فعليًا "لنا" (فلوس
// بتتحصّل من الشخص)، فالدفتر بيتسجّل عليه دايمًا direction:"in".
async function findOrCreateDebtAccount(tx, name, userId){
  const trimmed = (name || "").toString().trim();
  if(!trimmed) throw httpError(400, "اسم الشخص مطلوب");
  const existing = await tx.debtAccount.findFirst({ where: { name: { equals: trimmed, mode: "insensitive" } } });
  if(existing) return existing;
  return tx.debtAccount.create({ data: { id: uid(), name: trimmed, userId: userId || null, createdAt: new Date() } });
}
// إجماليات الحساب دايمًا محسوبة حية من SUM على الفواتير/الدفعات — نفس مبدأ
// recomputeDebtTotals تحت لكل فاتورة على حدة، بس هنا للحساب كله (مفيش رقم
// متراكم مخزّن على الحساب نفسه يقدر يعمل drift).
async function computeAccountTotals(client, accountId){
  const [invAgg, invCount, payAgg, payCount] = await Promise.all([
    client.debt.aggregate({ where: { accountId }, _sum: { totalAmount: true } }),
    client.debt.count({ where: { accountId } }),
    client.debtPayment.aggregate({ where: { accountId }, _sum: { amount: true } }),
    client.debtPayment.count({ where: { accountId } })
  ]);
  const totalAmount = invAgg._sum.totalAmount || 0;
  const paidAmount = payAgg._sum.amount || 0;
  const remainingAmount = Math.max(0, totalAmount - paidAmount);
  const status = debtStatusFromAmounts(totalAmount, paidAmount);
  return { totalAmount, paidAmount, remainingAmount, status, invoiceCount: invCount, paymentCount: payCount };
}
function buildInvoicePayload(input){
  const totalAmount = Number(input.totalAmount);
  const paidAmount = Math.max(0, Number(input.paidAmount) || 0);
  if(!(totalAmount > 0)) throw httpError(400, "قيمة الفاتورة يجب أن تكون أكبر من صفر");
  if(paidAmount > totalAmount + 0.004) throw httpError(400, "المبلغ المدفوع لا يمكن أن يتجاوز قيمة الفاتورة");
  return {
    number: (input.number || "").toString().trim() || null,
    totalAmount, paidAmount,
    date: input.date ? Number(input.date) : Date.now(),
    paymentMethod: input.paymentMethod || null,
    notes: (input.notes || "").trim() || null
  };
}
// الديون/الفواتير: المدفوع/المتبقي/الحالة على مستوى الفاتورة الواحدة دايمًا
// محسوبة من SUM(DebtPayment WHERE debtId=هذه الفاتورة) — مش قيمة متراكمة بتتزود
// يدويًا، عشان التعديل/الحذف الجزئي لأي دفعة يفضل متسق مهما كان ترتيب العمليات.
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
// بيبني ويتحقق من بيانات دفعة — لازم حساب شريك حقيقي (مؤمن/عبدو) دايمًا (كل
// دين هنا "لنا"، فالدفعة فلوس بتتحصّل فعليًا في حساب أحد الشريكين)، ولازم
// المبلغ ميتعديش المتبقي الممرر (remainingBefore بيتحسب على مستوى الحساب كله
// من الراوت اللي بينادي الدالة دي، مش على مستوى فاتورة واحدة فقط).
async function buildDebtPaymentPayload(input, remainingBefore){
  const amount = Number(input.amount);
  if(!(amount > 0)) throw httpError(400, "أدخل مبلغاً صحيحاً");
  if(!input.date) throw httpError(400, "تاريخ الدفعة مطلوب");
  if(remainingBefore <= 0.004) throw httpError(400, "لا يوجد مبلغ متبقٍ لتحصيله");
  if(amount > remainingBefore + 0.004) throw httpError(400, "قيمة الدفعة أكبر من المبلغ المتبقي.");
  const partner = normalizePartner(input.partner);
  if(!partner) throw httpError(400, "اختر الحساب (مؤمن/عبدو/ميدو)");
  return {
    amount, date: Number(input.date), paymentMethod: input.paymentMethod || null,
    notes: (input.notes || "").trim() || null,
    partner, payerName: PARTNER_LABELS[partner], direction: "in"
  };
}
// opts: accountId (إلزامي), debtId (اختياري — لو الدفعة مرتبطة بفاتورة بعينها),
// payload (من buildDebtPaymentPayload), userId, personLabel (لملاحظة الدفتر).
async function createDebtPayment(tx, opts){
  const paymentId = opts.id || uid();
  const now = new Date();

  await tx.debtPayment.create({ data: {
    id: paymentId, accountId: opts.accountId, debtId: opts.debtId || null,
    amount: opts.payload.amount, date: new Date(opts.payload.date),
    paymentMethod: opts.payload.paymentMethod, notes: opts.payload.notes,
    partner: opts.payload.partner, payerName: opts.payload.payerName, direction: opts.payload.direction,
    userId: opts.userId || null, createdAt: now, updatedAt: now,
    data: {
      id: paymentId, accountId: opts.accountId, debtId: opts.debtId || null, amount: opts.payload.amount, date: opts.payload.date,
      paymentMethod: opts.payload.paymentMethod, notes: opts.payload.notes, partner: opts.payload.partner,
      payerName: opts.payload.payerName, direction: opts.payload.direction, userId: opts.userId || null
    }
  }});

  await upsertPartnerLedger(tx, {
    partner: opts.payload.partner,
    type: "DEBT_PAYMENT",
    direction: "in",
    amount: opts.payload.amount,
    referenceType: "debtPayment",
    referenceId: paymentId,
    date: opts.payload.date,
    userId: opts.userId || null,
    notes: "دفعة دين — " + (opts.personLabel || ""),
    paymentMethod: opts.payload.paymentMethod || null
  });

  if(opts.debtId) await recomputeDebtTotals(tx, opts.debtId);
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
    findOne: function(id){ return prisma.user.findUnique({ where: { id }, include: { permissions: true } }); },
    async upsert(tx, it, isNew){
      const data = { name: it.name || null, username: it.username, password: it.password, role: it.role || null, canManageReturns: it.canManageReturns === false ? false : true };
      if(isNew) await tx.user.create({ data: { id: it.id, ...data } });
      else await tx.user.update({ where: { id: it.id }, data });

      // صلاحيات المستخدم: استبدال كامل (مسح ثم إعادة إنشاء) — نفس أسلوب
      // upsertPartnerLedger. بيتنفذ فقط لو الواجهة بعتت مصفوفة permissions
      // صراحة (يعني نموذج الصلاحيات اتفتح واتحفظ)، عشان أي نداء API قديم
      // مايمسحش صلاحيات موجودة بالغلط لو معندوش الحقل ده أصلاً.
      if(Array.isArray(it.permissions)){
        await tx.userPermission.deleteMany({ where: { userId: it.id } });
        const rows = it.permissions.filter(function(p){ return p && p.module && p.action; });
        for(const p of rows){
          await tx.userPermission.create({ data: { id: uid(), userId: it.id, module: String(p.module), action: String(p.action) } });
        }
      }
    },
    async remove(tx, id){ await tx.user.delete({ where: { id } }); }
  }
};
// module لكل نوع عام — null يعني الطريق ده مش محكوم بنظام الصلاحيات (customers/
// suppliers لسه ملهمش صفحة وصول في الواجهة، فبيفضلوا متاحين لأي مستخدم مسجل
// دخول زي ما هما دلوقتي بالظبط).
const GENERIC_MODULE_MAP = { products:"products", customers:null, suppliers:null, expenses:"expenses", income:"finance", users:"cashiers" };
// ملخص التغيير في صلاحيات مستخدم — بيتضاف لتفصيل سجل الحركات عند حفظ مستخدم،
// عشان نعرف مين غيّر ايه بالظبط (مطلوب صراحة في سجل الحركات/الأنشطة).
function diffPermissions(oldRows, newRows){
  function key(p){ return p.module + ":" + p.action; }
  const oldKeys = (oldRows||[]).map(key);
  const newKeys = (newRows||[]).map(key);
  const added = newKeys.filter(function(k){ return oldKeys.indexOf(k) === -1; });
  const removed = oldKeys.filter(function(k){ return newKeys.indexOf(k) === -1; });
  if(!added.length && !removed.length) return "";
  let s = "";
  if(added.length) s += " — أُضيف: " + added.join("، ");
  if(removed.length) s += " — أُزيل: " + removed.join("، ");
  return s;
}

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

  // بوابة الصلاحيات المركزية — لأي طريق قابل للتحديد بالكامل من method+url
  // (راجع ROUTE_PERMISSIONS). الطرق اللي بتفرّق بين create/edit من جوه الـ body
  // (المنتجات/المصاريف/الإيرادات/المستخدمين، و/api/returns) بتتفحص بمكانها.
  const routeAllowed = checkRoutePermission(user, method, url);
  if(routeAllowed === false){ send(res, 403, { ok:false, error: PERMISSION_DENIED }); return; }

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

    // إعادة حساب الإجمالي في الباك إند: لا ضريبة نهائيًا، والإجمالي = الإجمالي الفرعي - الخصم (لا يقل عن صفر)
    const saleItems = Array.isArray(saleIn.items) ? saleIn.items : [];
    const computedSubtotal = saleItems.reduce(function(a, it){ return a + (Number(it.price)||0) * (Number(it.qty)||0); }, 0);
    const computedDiscount = Math.max(0, Number(saleIn.discount) || 0);
    const computedTotal = Math.max(0, computedSubtotal - computedDiscount);
    saleIn.subtotal = computedSubtotal;
    saleIn.discount = computedDiscount;
    saleIn.tax = 0;
    saleIn.total = computedTotal;
    saleIn.profit = computedSubtotal - computedDiscount - saleItems.reduce(function(a, it){ return a + (Number(it.cost)||0) * (Number(it.qty)||0); }, 0);
    if(saleIn.paymentMethod === "cash"){
      saleIn.change = Math.max(0, (Number(saleIn.cashReceived)||0) - computedTotal);
    }

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
        referenceType: "sale", referenceId: saleIn.id, date: saleIn.date, userId: user.id, notes: "بيع — " + saleIn.number, paymentMethod: saleIn.paymentMethod || null });

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
    const b = await readBody(req);
    const saleId = b.saleId;
    const type = b.type === "exchange" ? "exchange" : "return";
    // نوع العملية (استرجاع/استبدال) بيحدد الصلاحية المطلوبة — الاتنين منفصلين
    // عن بعض عمدًا عشان يقدر المدير يسمح باسترجاع من غير استبدال أو العكس.
    if(!can(user, "returns", type)){ send(res, 403, { ok:false, error: PERMISSION_DENIED }); return; }
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
          referenceType: "return", referenceId: returnId, date: Date.now(), userId: user.id, notes: "استرجاع — " + number, paymentMethod: refundMethod || null });
        if(type === "exchange" && replacementTotal > 0){
          await upsertPartnerLedger(tx, { partner: "moamen", type: "EXCHANGE_ADJUSTMENT", direction: "in", amount: replacementTotal,
            referenceType: "return", referenceId: returnId + "-x", date: Date.now(), userId: user.id, notes: "استبدال (بديل) — " + number, paymentMethod: refundMethod || null });
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
    // الصلاحية اتفحصت بالفعل في البوابة المركزية فوق (returns.cancel عبر ROUTE_PERMISSIONS).
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
          referenceType: "orderCollection", referenceId: collId, date: orderIn.date, userId: user.id, notes: "عربون — " + orderIn.number, paymentMethod: orderIn.depositMethod || null });
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
    const partner = normalizePartner(b.partner);
    if(!(amount > 0)){ send(res, 400, {ok:false, error:"أدخل مبلغاً صحيحاً"}); return; }
    if(!partner){ send(res, 400, {ok:false, error:"اختر الحساب (مؤمن/عبدو/ميدو)"}); return; }
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
          referenceType: "orderCollection", referenceId: collId, date: payDate, userId: user.id, notes: "تحصيل COD — " + (fresh.number||""), paymentMethod: "cod" });

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
    const partner = normalizePartner(b.partner);
    if(!(amount > 0)){ send(res, 400, {ok:false, error:"أدخل مبلغاً صحيحاً"}); return; }
    if(!partner){ send(res, 400, {ok:false, error:"اختر الحساب (مؤمن/عبدو/ميدو)"}); return; }
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
          referenceType: "orderCollection", referenceId: collId, date: payDate, userId: user.id, notes: "تحصيل لاحق — " + (fresh.number||""), paymentMethod: b.paymentMethod || "cash" });

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
    const refundPartner = normalizePartner(b.refundPartner);

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
          if(!refundPartner) throw httpError(400, "هذا الاستبدال يترتب عليه استرداد مبلغ للعميل — اختر الحساب (مؤمن/عبدو/ميدو) اللي هيتحمّل الاسترداد");
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
    if(requestedInitialPaid > 0 && !normalizePartner(purchaseIn.partner)){
      send(res, 400, {ok:false, error:"اختر الحساب (مؤمن/عبدو/ميدو) للدفعة المبدئية"}); return;
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
            referenceType: "purchasePayment", referenceId: payId, date: purchaseIn.date, userId: user.id, notes: "دفعة مبدئية — " + purchaseIn.number, paymentMethod: purchaseIn.paymentMethod || null });
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
    const partner = normalizePartner(b.partner);
    if(!(amount > 0)){ send(res, 400, {ok:false, error:"أدخل مبلغاً صحيحاً"}); return; }
    if(!partner){ send(res, 400, {ok:false, error:"اختر الحساب (مؤمن/عبدو/ميدو)"}); return; }
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
          referenceType: "purchasePayment", referenceId: paymentId, date: payDate, userId: user.id, notes: "دفعة على فاتورة — " + (fresh.number||""), paymentMethod: b.paymentMethod || "cash" });

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

  /* ---------- الديون — نظام حسابات أشخاص (DebtAccount → Debt/فاتورة → DebtPayment) ---------- */
  // إضافة دين من الصفحة الرئيسية: إيجاد/إنشاء حساب الشخص بالاسم + إنشاء أول
  // فاتورة له + دفعة مبدئية اختيارية، كل ده في transaction واحدة عشان محدش
  // يقدر يعمل حسابين لنفس الاسم بسباق طلبات متزامنة.
  if(method === "POST" && url === "/api/debt-accounts"){
    const b = await readBody(req);
    const debtId = uid();
    let accountId;
    try{
      await prisma.$transaction(async function(tx){
        const account = await findOrCreateDebtAccount(tx, b.name, user.id);
        accountId = account.id;
        const invoice = buildInvoicePayload(b);
        const debtData = { id: debtId, accountId: account.id, personName: account.name, ...invoice };
        await tx.debt.create({ data: {
          id: debtId, accountId: account.id, number: invoice.number, personName: account.name,
          totalAmount: invoice.totalAmount, paidAmount: 0, remainingAmount: invoice.totalAmount, status: "unpaid",
          date: new Date(invoice.date), paymentMethod: invoice.paymentMethod, notes: invoice.notes,
          userId: user.id, data: debtData
        }});
        if(invoice.paidAmount > 0){
          const payload = await buildDebtPaymentPayload(
            { amount: invoice.paidAmount, date: invoice.date, paymentMethod: invoice.paymentMethod, notes: "دفعة مبدئية عند إنشاء الفاتورة", partner: b.partner },
            invoice.totalAmount
          );
          await createDebtPayment(tx, { accountId: account.id, debtId, payload, userId: user.id, personLabel: account.name });
        }
        await tx.auditLog.create({ data: auditEntry(req, "إضافة دين", account.name + " — " + invoice.totalAmount) });
      }, { timeout: 30000 });
    }catch(err){
      if(err && err.httpStatus){ send(res, err.httpStatus, { ok:false, error: err.message }); return; }
      throw err;
    }
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    const savedAccount = state.debtAccounts.find(function(a){ return a.id === accountId; });
    send(res, 200, { ok:true, db: state, account: savedAccount });
    return;
  }
  // إضافة فاتورة لحساب شخص معروف بالفعل (من داخل صفحة تفاصيل الحساب) — نفس
  // منطق إنشاء الفاتورة + الدفعة المبدئية فوق، لكن من غير إعادة البحث عن
  // الحساب بالاسم (الحساب معروف مسبقًا بـ id، فمفيش أي احتمال لإنشاء حساب تاني).
  if(method === "POST" && /^\/api\/debt-accounts\/[^/]+\/invoices$/.test(url)){
    const accountId = url.split("/")[3];
    const b = await readBody(req);
    const account = await prisma.debtAccount.findUnique({ where: { id: accountId } });
    if(!account){ send(res, 404, { ok:false, error:"الحساب غير موجود" }); return; }
    const debtId = uid();
    try{
      await prisma.$transaction(async function(tx){
        const invoice = buildInvoicePayload(b);
        const debtData = { id: debtId, accountId: account.id, personName: account.name, ...invoice };
        await tx.debt.create({ data: {
          id: debtId, accountId: account.id, number: invoice.number, personName: account.name,
          totalAmount: invoice.totalAmount, paidAmount: 0, remainingAmount: invoice.totalAmount, status: "unpaid",
          date: new Date(invoice.date), paymentMethod: invoice.paymentMethod, notes: invoice.notes,
          userId: user.id, data: debtData
        }});
        if(invoice.paidAmount > 0){
          const payload = await buildDebtPaymentPayload(
            { amount: invoice.paidAmount, date: invoice.date, paymentMethod: invoice.paymentMethod, notes: "دفعة مبدئية عند إنشاء الفاتورة", partner: b.partner },
            invoice.totalAmount
          );
          await createDebtPayment(tx, { accountId: account.id, debtId, payload, userId: user.id, personLabel: account.name });
        }
        await tx.auditLog.create({ data: auditEntry(req, "إضافة فاتورة", account.name + " — " + (invoice.number||"") + " — " + invoice.totalAmount) });
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
  if(method === "POST" && /^\/api\/debt-accounts\/[^/]+\/invoices\/[^/]+\/edit$/.test(url)){
    const parts = url.split("/"); // "", api, debt-accounts, accountId, invoices, invoiceId, edit
    const accountId = parts[3], invoiceId = parts[5];
    const b = await readBody(req);
    const existing = await prisma.debt.findUnique({ where: { id: invoiceId } });
    if(!existing || existing.accountId !== accountId){ send(res, 404, { ok:false, error:"الفاتورة غير موجودة" }); return; }
    try{
      await prisma.$transaction(async function(tx){
        const totalAmount = Number(b.totalAmount);
        if(!(totalAmount > 0)) throw httpError(400, "قيمة الفاتورة يجب أن تكون أكبر من صفر");
        if(totalAmount < (existing.paidAmount || 0) - 0.004){
          throw httpError(400, "لا يمكن أن تكون قيمة الفاتورة أقل من المبلغ المدفوع عليها.");
        }
        const number = (b.number !== undefined ? b.number : (existing.number || "")).toString().trim() || null;
        const date = b.date !== undefined ? Number(b.date) : (existing.date ? existing.date.getTime() : Date.now());
        const paymentMethod = b.paymentMethod !== undefined ? b.paymentMethod : existing.paymentMethod;
        const notes = (b.notes !== undefined ? b.notes : (existing.notes || "")).toString().trim() || null;
        const remainingAmount = Math.max(0, totalAmount - (existing.paidAmount || 0));
        const status = debtStatusFromAmounts(totalAmount, existing.paidAmount || 0);
        const data = { ...(existing.data || {}), number, totalAmount, date, paymentMethod, notes, remainingAmount, status };
        await tx.debt.update({ where: { id: invoiceId }, data: {
          number, totalAmount, remainingAmount, status, date: new Date(date), paymentMethod, notes, data
        }});
        await tx.auditLog.create({ data: auditEntry(req, "تعديل فاتورة", (existing.personName||"") + " — " + (number||"") + " — " + totalAmount) });
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
  if(method === "POST" && /^\/api\/debt-accounts\/[^/]+\/invoices\/[^/]+\/delete$/.test(url)){
    const parts = url.split("/");
    const accountId = parts[3], invoiceId = parts[5];
    const existing = await prisma.debt.findUnique({ where: { id: invoiceId } });
    if(!existing || existing.accountId !== accountId){ send(res, 404, { ok:false, error:"الفاتورة غير موجودة" }); return; }
    await prisma.$transaction(async function(tx){
      const payments = await tx.debtPayment.findMany({ where: { debtId: invoiceId }, select: { id: true } });
      for(const p of payments) await deletePartnerLedgerFor(tx, "debtPayment", p.id);
      await tx.debtPayment.deleteMany({ where: { debtId: invoiceId } });
      await tx.debt.delete({ where: { id: invoiceId } });
      await tx.auditLog.create({ data: auditEntry(req, "حذف فاتورة", (existing.personName||"") + " — " + (existing.number||"") + " — " + existing.totalAmount) });
    }, { timeout: 30000 });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  // دفعة عامة على الحساب (مش مرتبطة بفاتورة بعينها) — المتبقي المسموح بيه هنا
  // هو متبقي الحساب كله (SUM كل الفواتير - SUM كل الدفعات)، مش فاتورة واحدة.
  if(method === "POST" && /^\/api\/debt-accounts\/[^/]+\/payments$/.test(url)){
    const accountId = url.split("/")[3];
    const b = await readBody(req);
    const account = await prisma.debtAccount.findUnique({ where: { id: accountId } });
    if(!account){ send(res, 404, { ok:false, error:"الحساب غير موجود" }); return; }
    try{
      await prisma.$transaction(async function(tx){
        const totals = await computeAccountTotals(tx, accountId);
        const payload = await buildDebtPaymentPayload(b, totals.remainingAmount);
        await createDebtPayment(tx, { accountId, debtId: null, payload, userId: user.id, personLabel: account.name });
        await tx.auditLog.create({ data: auditEntry(req, "دفعة على حساب", account.name + " — " + payload.amount) });
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
  if(method === "POST" && /^\/api\/debt-accounts\/[^/]+\/payments\/[^/]+\/edit$/.test(url)){
    const parts = url.split("/");
    const accountId = parts[3], paymentId = parts[5];
    const b = await readBody(req);
    const existingPayment = await prisma.debtPayment.findUnique({ where: { id: paymentId } });
    if(!existingPayment || existingPayment.accountId !== accountId){ send(res, 404, { ok:false, error:"الدفعة غير موجودة" }); return; }
    try{
      await prisma.$transaction(async function(tx){
        const account = await tx.debtAccount.findUnique({ where: { id: accountId } });
        if(!account) throw httpError(404, "الحساب غير موجود");
        // نعكس أثر الدفعة القديمة على دفتر الشركاء الأول، قبل أي تحقق من القيمة
        // الجديدة — لو التحقق فشل بعد كده، الـ transaction كله بيترجع زي ما كان.
        await deletePartnerLedgerFor(tx, "debtPayment", paymentId);
        const invAgg = await tx.debt.aggregate({ where: { accountId }, _sum: { totalAmount: true } });
        const payAgg = await tx.debtPayment.aggregate({ where: { accountId, NOT: { id: paymentId } }, _sum: { amount: true } });
        const remainingBefore = Math.max(0, (invAgg._sum.totalAmount||0) - (payAgg._sum.amount||0));
        const payload = await buildDebtPaymentPayload(b, remainingBefore);
        const now = new Date();
        await tx.debtPayment.update({ where: { id: paymentId }, data: {
          amount: payload.amount, date: new Date(payload.date), paymentMethod: payload.paymentMethod, notes: payload.notes,
          partner: payload.partner, payerName: payload.payerName, direction: payload.direction, updatedAt: now,
          data: {
            ...(existingPayment.data || {}), amount: payload.amount, date: payload.date, paymentMethod: payload.paymentMethod,
            notes: payload.notes, partner: payload.partner, payerName: payload.payerName, direction: payload.direction
          }
        }});
        await upsertPartnerLedger(tx, {
          partner: payload.partner, type: "DEBT_PAYMENT", direction: "in", amount: payload.amount,
          referenceType: "debtPayment", referenceId: paymentId, date: payload.date, userId: existingPayment.userId || user.id,
          notes: "دفعة دين (معدّلة) — " + account.name, paymentMethod: payload.paymentMethod || null
        });
        if(existingPayment.debtId) await recomputeDebtTotals(tx, existingPayment.debtId);
        await tx.auditLog.create({ data: auditEntry(req, "تعديل دفعة", account.name + " — " + payload.amount) });
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
  if(method === "POST" && /^\/api\/debt-accounts\/[^/]+\/payments\/[^/]+\/delete$/.test(url)){
    const parts = url.split("/");
    const accountId = parts[3], paymentId = parts[5];
    const existingPayment = await prisma.debtPayment.findUnique({ where: { id: paymentId } });
    if(!existingPayment || existingPayment.accountId !== accountId){ send(res, 404, { ok:false, error:"الدفعة غير موجودة" }); return; }
    const account = await prisma.debtAccount.findUnique({ where: { id: accountId } });
    await prisma.$transaction(async function(tx){
      await deletePartnerLedgerFor(tx, "debtPayment", paymentId);
      await tx.debtPayment.delete({ where: { id: paymentId } });
      if(existingPayment.debtId) await recomputeDebtTotals(tx, existingPayment.debtId);
      await tx.auditLog.create({ data: auditEntry(req, "حذف دفعة", (account?account.name:"") + " — " + existingPayment.amount) });
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
      const module = GENERIC_MODULE_MAP[g];
      if(module && !can(user, module, isNew ? "create" : "edit")){ send(res, 403, { ok:false, error: PERMISSION_DENIED }); return; }
      if(g === "products"){
        const modelCode = (it.modelCode||"").trim();
        if(!modelCode){ send(res, 400, {ok:false, error:"كود الموديل مطلوب"}); return; }
        it.modelCode = modelCode;
        const dupe = await prisma.product.findFirst({ where: { modelCode } });
        if(dupe && dupe.id !== it.id){ send(res, 400, {ok:false, error:"كود الموديل \""+modelCode+"\" مستخدم بالفعل لمنتج آخر"}); return; }
      }
      if(g === "expenses" || g === "income"){
        // partner هنا اختياري عمدًا: فاضي/غير معروف = مصروف أو إيراد "المحل / مشترك"
        // (بيتسجل في المصاريف/الإيرادات العامة لكن من غير ما يخصم/يضاف لأي رصيد
        // شريك شخصي — راجع upsertPartnerLedger اللي بيتجاهل partner غير الشركاء
        // التلاتة الحقيقيين). لو اتبعتت قيمة partner لازم تكون واحدة من التلاتة.
        if(it.partner && !normalizePartner(it.partner)){ send(res, 400, {ok:false, error:"الحساب غير صحيح — اختر مؤمن/عبدو/ميدو أو اتركه للمحل"}); return; }
        it.partner = normalizePartner(it.partner);
      }
      // ما ينفعش حد يغيّر آخر مدير في النظام لكاشير — هيقفل صفحة المستخدمين
      // على الجميع بلا رجعة (نفس مبدأ منع حذف آخر مدير تحت).
      if(g === "users" && !isNew && existing.role === "admin" && it.role !== "admin"){
        const adminCount = await prisma.user.count({ where: { role: "admin" } });
        if(adminCount <= 1){ send(res, 400, {ok:false, error:"لا يمكن تغيير صلاحية آخر مدير — لازم يفضل مدير واحد على الأقل بالنظام"}); return; }
      }
      try{
        await prisma.$transaction(async function(tx){
          await cfg.upsert(tx, it, isNew);
          if(g === "expenses"){
            await upsertPartnerLedger(tx, { partner: it.partner, type: "EXPENSE", direction: "out", amount: it.amount,
              referenceType: "expense", referenceId: it.id, date: it.date, userId: it.userId || user.id, notes: it.note || null, paymentMethod: it.paymentMethod || null });
          } else if(g === "income"){
            await upsertPartnerLedger(tx, { partner: it.partner, type: "OTHER_INCOME", direction: "in", amount: it.amount,
              referenceType: "otherIncome", referenceId: it.id, date: it.date, userId: it.userId || user.id, notes: it.note || null });
          }
          let detail = cfg.logDetail(it);
          if(g === "users" && Array.isArray(it.permissions)){
            detail += diffPermissions(existing ? existing.permissions : [], it.permissions);
          }
          await tx.auditLog.create({ data: auditEntry(req, isNew ? cfg.addLabel : cfg.editLabel, detail) });
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
      const module = GENERIC_MODULE_MAP[g];
      if(module && !can(user, module, "delete")){ send(res, 403, { ok:false, error: PERMISSION_DENIED }); return; }
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

  /* ---------- أوامر الطباعة (تحويل مخزون داخلي بين موديلين — بدون أي أثر مالي) ----------
     مش بيع ولا شراء ولا مرتجع؛ خصم من موديل مصدر + إضافة نفس الكمية بالظبط لموديل
     ناتج، فوق نفس بنية Product/ProductVariant الموجودة (نفس adjustVariantStock/
     recomputeProductStock المستخدمة في كل عمليات المخزون الأخرى). "المتاح" هنا =
     stock الحالي مباشرة — النظام مفيهوش رصيد "محجوز" منفصل (الكمية بتتخصم من
     الـ variant فورًا وقت أي بيع/أوردر، مش عند التسليم)، فمفيش رصيد تاني يتفرق عنه. */
  if(method === "POST" && url === "/api/printing-orders"){
    const b = await readBody(req);
    const sourceVariantId = b.sourceVariantId || "";
    const targetVariantId = b.targetVariantId || "";
    const quantity = parseInt(b.quantity, 10) || 0;
    const notes = (b.notes || "").trim() || null;
    const dateVal = b.date ? Number(b.date) : Date.now();

    if(!sourceVariantId){ send(res, 400, { ok:false, error:"الموديل المصدر مطلوب" }); return; }
    if(!targetVariantId){ send(res, 400, { ok:false, error:"الموديل الناتج مطلوب" }); return; }
    if(sourceVariantId === targetVariantId){ send(res, 400, { ok:false, error:"لا يمكن أن يكون الموديل المصدر هو نفس الموديل الناتج" }); return; }
    if(!(quantity > 0)){ send(res, 400, { ok:false, error:"الكمية يجب أن تكون أكبر من صفر" }); return; }

    const printingOrderId = uid();
    try{
      await prisma.$transaction(async function(tx){
        const sourceVariant = await tx.productVariant.findUnique({ where: { id: sourceVariantId } });
        if(!sourceVariant) throw httpError(400, "الموديل المصدر غير موجود");
        const targetVariant = await tx.productVariant.findUnique({ where: { id: targetVariantId } });
        if(!targetVariant) throw httpError(400, "الموديل الناتج غير موجود");

        const available = sourceVariant.stock || 0;
        if(quantity > available) throw httpError(400, "الكمية المطلوبة أكبر من الكمية المتاحة");

        const sourceProduct = sourceVariant.productId ? await tx.product.findUnique({ where: { id: sourceVariant.productId } }) : null;
        const targetProduct = targetVariant.productId ? await tx.product.findUnique({ where: { id: targetVariant.productId } }) : null;

        await adjustVariantStock(tx, sourceVariantId, -quantity);
        await recomputeProductStock(tx, sourceVariant.productId);
        await adjustVariantStock(tx, targetVariantId, quantity);
        await recomputeProductStock(tx, targetVariant.productId);

        const setting = await tx.setting.findUnique({ where: { id: 'main' } });
        const settings = (setting && setting.data) || {};
        const counter = settings.printingOrderCounter || 1001;
        const orderNumber = "TP-" + counter;
        settings.printingOrderCounter = counter + 1;
        await tx.setting.update({ where: { id: 'main' }, data: { printingOrderCounter: settings.printingOrderCounter, data: settings } });

        const rec = {
          id: printingOrderId, orderNumber, date: dateVal,
          sourceProductId: sourceVariant.productId, sourceVariantId: sourceVariant.id,
          sourceModelCode: sourceProduct ? sourceProduct.modelCode : null, sourceProductName: sourceProduct ? sourceProduct.name : null,
          sourceColor: sourceVariant.color || null, sourceSize: sourceVariant.size || null,
          targetProductId: targetVariant.productId, targetVariantId: targetVariant.id,
          targetModelCode: targetProduct ? targetProduct.modelCode : null, targetProductName: targetProduct ? targetProduct.name : null,
          targetColor: targetVariant.color || null, targetSize: targetVariant.size || null,
          quantity, status: "منفذ", notes, userId: user.id
        };
        await tx.printingOrder.create({ data: {
          id: printingOrderId, orderNumber, date: new Date(dateVal),
          sourceProductId: rec.sourceProductId, sourceVariantId: rec.sourceVariantId,
          sourceModelCode: rec.sourceModelCode, sourceProductName: rec.sourceProductName,
          sourceColor: rec.sourceColor, sourceSize: rec.sourceSize,
          targetProductId: rec.targetProductId, targetVariantId: rec.targetVariantId,
          targetModelCode: rec.targetModelCode, targetProductName: rec.targetProductName,
          targetColor: rec.targetColor, targetSize: rec.targetSize,
          quantity: quantity, status: "منفذ", notes: notes, userId: user.id,
          createdAt: new Date(), updatedAt: new Date(), data: rec
        }});

        await tx.auditLog.create({ data: auditEntry(req, "أمر طباعة",
          orderNumber + " — " + (rec.sourceModelCode||"") + " → " + (rec.targetModelCode||"") + " — " + quantity) });
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
  if(method === "POST" && /^\/api\/printing-orders\/[^/]+\/cancel$/.test(url)){
    const id = url.split("/")[3];
    const existing = await prisma.printingOrder.findUnique({ where: { id } });
    if(!existing){ send(res, 404, { ok:false, error:"أمر الطباعة غير موجود" }); return; }
    if(existing.status === "ملغي"){ send(res, 409, { ok:false, error:"أمر الطباعة ملغي بالفعل" }); return; }
    try{
      await prisma.$transaction(async function(tx){
        const fresh = await tx.printingOrder.findUnique({ where: { id } });
        if(!fresh) throw httpError(404, "أمر الطباعة غير موجود");
        if(fresh.status === "ملغي") throw httpError(409, "أمر الطباعة ملغي بالفعل");

        const qty = fresh.quantity || 0;
        if(fresh.sourceVariantId){
          await adjustVariantStock(tx, fresh.sourceVariantId, qty);
          if(fresh.sourceProductId) await recomputeProductStock(tx, fresh.sourceProductId);
        }
        if(fresh.targetVariantId){
          await adjustVariantStock(tx, fresh.targetVariantId, -qty);
          if(fresh.targetProductId) await recomputeProductStock(tx, fresh.targetProductId);
        }

        const mergedData = { ...(fresh.data||{}), statusBeforeCancel: fresh.status, cancelledAt: Date.now(), cancelledBy: user.id };
        await tx.printingOrder.update({ where: { id }, data: {
          status: "ملغي", cancelledAt: new Date(), cancelledBy: user.id, updatedAt: new Date(), data: mergedData
        }});

        await tx.auditLog.create({ data: auditEntry(req, "إلغاء أمر طباعة", fresh.orderNumber || id) });
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
    if(!normalizePartner(it.partner)){ send(res, 400, {ok:false, error:"اختر الحساب (مؤمن/عبدو/ميدو)"}); return; }
    it.id = it.id || uid();
    it.date = Date.now();
    it.userId = user.id;
    await prisma.$transaction(async function(tx){
      await tx.paymentOut.create({ data: { id: it.id, supplierName: it.supplierName || null, amount: it.amount != null ? it.amount : null, date: new Date(it.date), userId: it.userId, partner: it.partner, data: it } });
      await upsertPartnerLedger(tx, { partner: it.partner, type: "PURCHASE_PAYMENT", direction: "out", amount: it.amount,
        referenceType: "paymentOut", referenceId: it.id, date: it.date, userId: it.userId, notes: "دفعة للمورد — " + (it.supplierName||""), paymentMethod: it.paymentMethod || null });
      await tx.auditLog.create({ data: auditEntry(req, "دفع للمورد", it.supplierName + " — " + it.amount) });
    });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    send(res, 200, { ok:true, db: state });
    return;
  }
  /* ---------- قيود يدوية على دفتر شريك (رصيد افتتاحي / مبلغ مُضاف / مستحقات أخرى /
     مسحوبات / خصومات وتسويات) — تكمّل السجلات المرآة تلقائيًا (بيع/مصروف/إيراد...)
     بحركات بتتسجل مباشرة على PartnerTransaction نفسه بدون جدول مصدر منفصل، لأنها
     مش انعكاس لعملية في جدول تاني. الرصيد الافتتاحي حالة خاصة: صف واحد بالظبط لكل
     شريك (upsert فعلي عبر referenceId ثابت = "opening-"+partner)، وباقي الأنواع كل
     واحدة سجل مستقل قائم بذاته (referenceId = معرّفها هي). راجع partnerBalance()
     بالواجهة — بتجمع كل الأنواع دي تلقائيًا لأنها مش بتفرّق بين type. */
  const PARTNER_MANUAL_TYPES = {
    OPENING_BALANCE: "in", MANUAL_ADD: "in", OTHER_DUE: "in",
    WITHDRAWAL: "out", DEDUCTION: "out", PARTNER_TRANSFER: "out"
  };
  if(method === "POST" && url === "/api/partners/ledger"){
    const b = await readBody(req);
    const it = b.item || {};
    const partner = normalizePartner(it.partner);
    if(!partner){ send(res, 400, {ok:false, error:"اختر الشريك (مؤمن/عبدو/ميدو)"}); return; }
    const type = Object.prototype.hasOwnProperty.call(PARTNER_MANUAL_TYPES, it.type) ? it.type : null;
    if(!type){ send(res, 400, {ok:false, error:"نوع الحركة غير صحيح"}); return; }
    const amount = Number(it.amount);
    if(!(amount > 0)){ send(res, 400, {ok:false, error:"أدخل مبلغاً صحيحاً"}); return; }
    const direction = PARTNER_MANUAL_TYPES[type];
    const date = it.date ? new Date(it.date).getTime() : Date.now();
    const notes = (it.notes || "").trim() || null;
    const referenceType = type === "OPENING_BALANCE" ? "partnerOpening" : "partnerManual";
    const referenceId = type === "OPENING_BALANCE" ? ("opening-" + partner) : uid();
    try{
      await prisma.$transaction(async function(tx){
        await upsertPartnerLedger(tx, { partner, type, direction, amount,
          referenceType, referenceId, date, userId: user.id, notes });
        await tx.auditLog.create({ data: auditEntry(req, "قيد يدوي — " + ledgerManualLabel(type),
          PARTNER_LABELS[partner] + " — " + amount + (notes ? (" — " + notes) : "")) });
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
  if(method === "POST" && /^\/api\/partners\/ledger\/[^/]+\/delete$/.test(url)){
    const id = url.split("/")[4];
    const existing = await prisma.partnerTransaction.findUnique({ where: { id } });
    if(!existing){ send(res, 404, {ok:false, error:"الحركة غير موجودة"}); return; }
    if(existing.referenceType !== "partnerManual" && existing.referenceType !== "partnerOpening"){
      send(res, 400, {ok:false, error:"هذه الحركة مرتبطة بعملية أخرى في النظام ولا يمكن حذفها من هنا"}); return;
    }
    await prisma.$transaction(async function(tx){
      await tx.partnerTransaction.delete({ where: { id } });
      await tx.auditLog.create({ data: auditEntry(req, "حذف قيد يدوي — " + ledgerManualLabel(existing.type),
        PARTNER_LABELS[existing.partner] + " — " + existing.amount) });
    }, { timeout: 30000 });
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
