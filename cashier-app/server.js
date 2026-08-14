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
    return { id: uid(), name, category, price, cost, stock, sizes, colors, sku, emoji, image: "", offer: null,
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
      storeName:"بوتيك الموضة", currency:"ج.م", taxRate:14, lowStockThreshold:5,
      invoicePrefix:"INV", invoiceCounter:1001, purchaseCounter:1001, orderCounter:1001,
      receiptFooter:"شكراً لزيارتكم — نتمنى لكم يوماً سعيداً", phone:"01000000000"
    },
    users: [
      { id:"u_admin", name:"مدير المتجر", username:"admin", password:"admin", role:"admin" },
      { id:"u_cash", name:"كاشير 1", username:"cashier", password:"1234", role:"cashier" }
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

/* ---------- عناصر عامة (إضافة/تعديل/حذف) ---------- */
const genericModels = {
  products: {
    addLabel: "إضافة منتج", editLabel: "تعديل منتج", delLabel: "حذف منتج",
    logDetail: function(it){ return it.name; },
    findOne: function(id){ return prisma.product.findUnique({ where: { id } }); },
    async upsert(tx, it, isNew){
      const stock = stockOf(it);
      it.stock = stock;
      const data = {
        name: it.name, category: it.category || null, price: it.price != null ? it.price : null, cost: it.cost != null ? it.cost : null,
        stock: stock, sku: it.sku || null, image: it.image || null, emoji: it.emoji || null, data: it
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
      const data = { category: it.category || null, amount: it.amount != null ? it.amount : null, date: it.date ? new Date(it.date) : new Date(), note: it.note || null, userId: it.userId || null, data: it };
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
      const data = { note: it.note || null, amount: it.amount != null ? it.amount : null, date: it.date ? new Date(it.date) : new Date(), userId: it.userId || null, data: it };
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
      const data = { name: it.name || null, username: it.username, password: it.password, role: it.role || null };
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
      await tx.sale.delete({ where: { id } });
      await tx.auditLog.create({ data: auditEntry(req, "إرجاع فاتورة", existing.number || "") });
    }, { timeout: 30000 });
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

      await tx.order.create({ data: {
        id: orderIn.id, number: orderIn.number, date: new Date(orderIn.date), userId: orderIn.userId,
        customerName: orderIn.customerName || null, total: orderIn.total != null ? orderIn.total : null, status: orderIn.status || "new", data: orderIn,
        items: { create: (orderIn.items||[]).map(function(it){ return { id: uid(), productId: it.productId||null, variantId: it.variantId||null, qty: it.qty!=null?it.qty:null, price: it.price!=null?it.price:null, data: it }; }) }
      }});

      for(const d of decrements){
        await adjustVariantStock(tx, d.variantId, -(d.qty||0));
        await recomputeProductStock(tx, d.productId);
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
  if(method === "POST" && /^\/api\/order\/[^/]+\/cod$/.test(url)){
    const id = url.split("/")[3];
    const b = await readBody(req);
    let byUser = null;
    if(b.collected !== false){
      byUser = await prisma.user.findUnique({ where: { id: b.byId || user.id } });
    }
    await orderPatch(id, req, res, function(o){
      if(b.collected === false){
        o.collected = false; o.collectedBy = null; o.collectedAt = null; o.collectedAmount = null;
      } else {
        o.collected = true; o.collectedBy = b.byId || user.id; o.collectedAt = Date.now(); o.collectedAmount = b.amount;
      }
    }, function(o){
      if(b.collected === false) return { action: "إلغاء تحصيل COD", detail: o.number };
      return { action: "تحصيل COD", detail: o.number + " — " + b.amount + " (" + (byUser?byUser.name:"") + ")" };
    });
    return;
  }
  if(method === "POST" && /^\/api\/order\/[^/]+\/return$/.test(url)){
    const id = url.split("/")[3];
    await orderPatch(id, req, res, function(o){ o.status = "returned"; }, function(o){ return { action: "مرتجع أوردر", detail: o.number }; }, restoreOrderStock);
    return;
  }
  if(method === "POST" && /^\/api\/order\/[^/]+\/cancel$/.test(url)){
    const id = url.split("/")[3];
    await orderPatch(id, req, res, function(o){ o.status = "cancelled"; }, function(o){ return { action: "إلغاء أوردر", detail: o.number }; }, restoreOrderStock);
    return;
  }

  /* ---------- المشتريات ---------- */
  if(method === "POST" && url === "/api/purchase"){
    const b = await readBody(req);
    const purchaseIn = b.purchase || {};
    const increments = b.increments || [];
    const purchaseId = purchaseIn.id || uid();
    await prisma.$transaction(async function(tx){
      const setting = await tx.setting.findUnique({ where: { id: 'main' } });
      const settings = (setting && setting.data) || {};
      const counter = settings.purchaseCounter || 1001;
      purchaseIn.id = purchaseId;
      purchaseIn.number = "PUR-" + counter;
      purchaseIn.date = Date.now();
      purchaseIn.userId = user.id;
      settings.purchaseCounter = counter + 1;
      await tx.setting.update({ where: { id: 'main' }, data: { purchaseCounter: settings.purchaseCounter, data: settings } });

      await tx.purchase.create({ data: {
        id: purchaseIn.id, number: purchaseIn.number, date: new Date(purchaseIn.date), userId: purchaseIn.userId,
        supplierId: purchaseIn.supplierId || null, supplierName: purchaseIn.supplierName || null, total: purchaseIn.total != null ? purchaseIn.total : null, data: purchaseIn,
        items: { create: (purchaseIn.items||[]).map(function(it){ return { id: uid(), productId: it.productId||null, variantId: it.variantId||null, qty: it.qty!=null?it.qty:null, cost: it.cost!=null?it.cost:null, data: it }; }) }
      }});

      for(const d of increments){
        await adjustVariantStock(tx, d.variantId, d.qty||0);
        if(d.productId){
          if(d.cost !== undefined && d.cost !== null) await tx.product.update({ where: { id: d.productId }, data: { cost: d.cost } });
          await recomputeProductStock(tx, d.productId);
        }
      }

      await tx.auditLog.create({ data: auditEntry(req, "فاتورة شراء", purchaseIn.number + " — " + purchaseIn.supplierName + " — " + purchaseIn.total + " " + (settings.currency||"")) });
    }, { timeout: 30000 });
    await db.trimAuditLog();
    const state = await db.buildStateFromDB();
    const savedPurchase = state.purchases.find(function(p){ return p.id === purchaseId; });
    send(res, 200, { ok:true, db: state, purchase: savedPurchase });
    return;
  }
  if(method === "POST" && /^\/api\/purchase\/[^/]+\/delete$/.test(url)){
    const id = url.split("/")[3];
    const existing = await prisma.purchase.findUnique({ where: { id }, include: { items: true } });
    if(!existing){ send(res, 404, {ok:false}); return; }
    await prisma.$transaction(async function(tx){
      for(const it of existing.items){
        await adjustVariantStock(tx, it.variantId, -(it.qty||0));
        await recomputeProductStock(tx, it.productId);
      }
      await tx.purchase.delete({ where: { id } });
      await tx.auditLog.create({ data: auditEntry(req, "حذف فاتورة شراء", existing.number || "") });
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
      await prisma.$transaction(async function(tx){
        await cfg.upsert(tx, it, isNew);
        await tx.auditLog.create({ data: auditEntry(req, isNew ? cfg.addLabel : cfg.editLabel, cfg.logDetail(it)) });
      }, { timeout: 30000 });
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
    it.id = it.id || uid();
    it.date = Date.now();
    it.userId = user.id;
    await prisma.$transaction(async function(tx){
      await tx.paymentOut.create({ data: { id: it.id, supplierName: it.supplierName || null, amount: it.amount != null ? it.amount : null, date: new Date(it.date), userId: it.userId, data: it } });
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
