/* ============================================================
   سيستم كاشير محل ملابس — سيرفر (Node.js بدون اعتماديات)
   بيخدم الواجهة + API + قاعدة بيانات JSON (ملف على القرص)
   ============================================================ */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const db = require('./src/db');

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

/* ---------- حالة السيرفر ---------- */
let state = null;
const tokens = new Map(); // token -> userId

async function loadState(){
  // try DB raw snapshot first
  try{
    const raw = await db.getRawState();
    if(raw){ state = raw; }
    else {
      try { state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
      catch(e){ state = seed(); }
      // persist initial state to DB (non-blocking)
      db.saveRawState(state).catch(function(err){ console.error('saveRawState error', err); });
    }
  }catch(e){
    // DB unavailable — fallback to file
    try { state = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
    catch(e){ state = seed(); }
  }
  // ضمان وجود كل المفاتيح بعد تحديثات قديمة
  ["users","categories","products","customers","suppliers","purchases","audit","sales",
   "shippingCompanies","shipPrices","orders","expenseCategories","expenses","otherIncome",
   "paymentsIn","paymentsOut","cashClosings","transfers"].forEach(function(k){ if(!state[k]) state[k] = []; });
  if(!state.settings) state.settings = seed().settings;
}
function saveState(){
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, DATA_FILE);
  } catch(e){ console.error("save error", e); }
  // also persist to DB asynchronously (snapshot)
  db.saveRawState(state).catch(function(err){ console.error('saveRawState error', err); });
}

/* ---------- سجل الحركات ---------- */
function log(req, action, detail){
  const u = req.user || null;
  state.audit = state.audit || [];
  state.audit.push({ id: uid(), date: Date.now(), userId: u ? u.id : null, userName: u ? u.name : "النظام", action, detail: detail||"" });
  if(state.audit.length > 3000) state.audit = state.audit.slice(-3000);
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
function authUser(req){
  let token = null;
  const c = parseCookies(req);
  if(c.token) token = c.token;
  if(req.headers.authorization && req.headers.authorization.indexOf("Bearer ")===0) token = req.headers.authorization.slice(7);
  if(!token) return null;
  const userId = tokens.get(token);
  if(!userId) return null;
  return state.users.find(function(u){ return u.id === userId; }) || null;
}

/* ---------- إرجاع الحالة كاملة ---------- */
function dbPayload(){ return JSON.parse(JSON.stringify(state)); }

/* ---------- توجيه الطلبات ---------- */
const server = http.createServer(async function(req, res){
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
  if(method === "GET" && url === "/api/health"){ send(res, 200, {ok:true}); return; }

  if(method === "POST" && url === "/api/login"){
    const b = await readBody(req);
    const u = state.users.find(function(x){ return x.username === (b.username||"").trim() && x.password === (b.password||""); });
    if(!u){ send(res, 401, {ok:false, error:"بيانات الدخول غير صحيحة"}); return; }
    const token = crypto.randomUUID();
    tokens.set(token, u.id);
    res.setHeader("Set-Cookie", "token="+token+"; HttpOnly; Path=/; SameSite=Lax; Max-Age=" + 60*60*24*30);
    log({user:u}, "تسجيل دخول", u.name);
    saveState();
    send(res, 200, { ok:true, token, user:{id:u.id, name:u.name, username:u.username, role:u.role}, db: dbPayload() });
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
  const user = authUser(req);
  if(!user){ send(res, 401, {ok:false, error:"غير مسجل دخول"}); return; }
  req.user = user;

  if(method === "GET" && url === "/api/state"){
    send(res, 200, { ok:true, db: dbPayload(), userId: user.id });
    return;
  }

  /* ---------- البيع ---------- */
  if(method === "POST" && url === "/api/sale"){
    const b = await readBody(req);
    const sale = b.sale || {};
    const decrements = b.decrements || [];
    sale.id = sale.id || uid();
    sale.number = state.settings.invoicePrefix + "-" + state.settings.invoiceCounter;
    state.settings.invoiceCounter++;
    sale.date = Date.now();
    sale.userId = user.id;
    state.sales.push(sale);
    decrements.forEach(function(d){
      const p = state.products.find(function(x){ return x.id === d.productId; });
      if(p){
        const v = (p.variants||[]).find(function(x){ return x.id === d.variantId; });
        if(v) v.stock = Math.max(0, v.stock - d.qty);
        p.stock = stockOf(p);
      }
    });
    log(req, "بيع", "فاتورة " + sale.number + " — " + sale.total + " " + state.settings.currency);
    saveState();
    send(res, 200, { ok:true, db: dbPayload(), sale: sale });
    return;
  }
  if(method === "POST" && /^\/api\/sale\/[^/]+\/return$/.test(url)){
    const id = url.split("/")[3];
    const s = state.sales.find(function(x){ return x.id === id; });
    if(!s){ send(res, 404, {ok:false}); return; }
    s.items.forEach(function(it){
      const p = state.products.find(function(x){ return x.id === it.productId; });
      if(p){
        let v = (p.variants||[]).find(function(x){ return x.id === it.variantId; });
        if(!v && (it.size || it.color)) v = (p.variants||[]).find(function(x){ return (x.size||null)===(it.size||null) && (x.color||null)===(it.color||null); });
        if(!v) v = (p.variants||[])[0];
        if(v) v.stock += it.qty;
        p.stock = stockOf(p);
      }
    });
    state.sales = state.sales.filter(function(x){ return x.id !== id; });
    log(req, "إرجاع فاتورة", s.number);
    saveState();
    send(res, 200, { ok:true, db: dbPayload() });
    return;
  }

  /* ---------- الأوردرات ---------- */
  if(method === "POST" && url === "/api/order"){
    const b = await readBody(req);
    const order = b.order || {};
    const decrements = b.decrements || [];
    order.id = order.id || uid();
    order.number = "ORD-" + (state.settings.orderCounter || 1001);
    state.settings.orderCounter = (state.settings.orderCounter || 1001) + 1;
    order.date = Date.now();
    order.userId = user.id;
    state.orders.push(order);
    decrements.forEach(function(d){
      const p = state.products.find(function(x){ return x.id === d.productId; });
      if(p){
        const v = (p.variants||[]).find(function(x){ return x.id === d.variantId; });
        if(v) v.stock = Math.max(0, v.stock - d.qty);
        p.stock = stockOf(p);
      }
    });
    log(req, "أوردر جديد", order.number + " — " + order.customerName + " — " + order.total + " " + state.settings.currency);
    saveState();
    send(res, 200, { ok:true, db: dbPayload(), order: order });
    return;
  }
  function orderPatch(fn){
    const id = url.split("/")[3];
    const o = state.orders.find(function(x){ return x.id === id; });
    if(!o) return send(res, 404, {ok:false});
    fn(o);
    saveState();
    send(res, 200, { ok:true, db: dbPayload() });
  }
  if(method === "POST" && /^\/api\/order\/[^/]+\/status$/.test(url)){
    const b = await readBody(req);
    orderPatch(function(o){ o.status = b.status; if(b.status==="shipped") o.shippedDate = Date.now(); if(b.status==="delivered") o.deliveredDate = Date.now();
      log(req, "تحديث حالة أوردر", o.number+" → "+b.status); });
    return;
  }
  if(method === "POST" && /^\/api\/order\/[^/]+\/shipment$/.test(url)){
    const b = await readBody(req);
    orderPatch(function(o){ o.companyId = b.companyId || null; o.awb = (b.awb||"").trim();
      log(req, "تحديث شحنة", o.number + (o.awb ? " — "+o.awb : "")); });
    return;
  }
  if(method === "POST" && /^\/api\/order\/[^/]+\/cod$/.test(url)){
    const b = await readBody(req);
    orderPatch(function(o){
      if(b.collected === false){
        o.collected = false; o.collectedBy = null; o.collectedAt = null; o.collectedAmount = null;
        log(req, "إلغاء تحصيل COD", o.number);
      } else {
        o.collected = true; o.collectedBy = b.byId || user.id; o.collectedAt = Date.now(); o.collectedAmount = b.amount;
        const by = state.users.find(function(x){ return x.id === o.collectedBy; });
        log(req, "تحصيل COD", o.number + " — " + b.amount + " (" + (by?by.name:"") + ")");
      }
    });
    return;
  }
  function restoreOrder(o){
    o.items.forEach(function(it){
      const p = state.products.find(function(x){ return x.id === it.productId; });
      if(p){
        const v = (p.variants||[]).find(function(x){ return x.id === it.variantId; });
        if(v) v.stock += it.qty;
        p.stock = stockOf(p);
      }
    });
  }
  if(method === "POST" && /^\/api\/order\/[^/]+\/return$/.test(url)){
    orderPatch(function(o){ restoreOrder(o); o.status = "returned"; log(req, "مرتجع أوردر", o.number); });
    return;
  }
  if(method === "POST" && /^\/api\/order\/[^/]+\/cancel$/.test(url)){
    orderPatch(function(o){ restoreOrder(o); o.status = "cancelled"; log(req, "إلغاء أوردر", o.number); });
    return;
  }

  /* ---------- المشتريات ---------- */
  if(method === "POST" && url === "/api/purchase"){
    const b = await readBody(req);
    const purchase = b.purchase || {};
    const increments = b.increments || [];
    purchase.id = purchase.id || uid();
    purchase.number = "PUR-" + (state.settings.purchaseCounter || 1001);
    state.settings.purchaseCounter = (state.settings.purchaseCounter || 1001) + 1;
    purchase.date = Date.now();
    purchase.userId = user.id;
    state.purchases.push(purchase);
    increments.forEach(function(d){
      const p = state.products.find(function(x){ return x.id === d.productId; });
      if(p){
        const v = (p.variants||[]).find(function(x){ return x.id === d.variantId; });
        if(v) v.stock += d.qty;
        if(d.cost !== undefined && d.cost !== null) p.cost = d.cost;
        p.stock = stockOf(p);
      }
    });
    log(req, "فاتورة شراء", purchase.number + " — " + purchase.supplierName + " — " + purchase.total + " " + state.settings.currency);
    saveState();
    send(res, 200, { ok:true, db: dbPayload(), purchase: purchase });
    return;
  }
  if(method === "POST" && /^\/api\/purchase\/[^/]+\/delete$/.test(url)){
    const id = url.split("/")[3];
    const p = state.purchases.find(function(x){ return x.id === id; });
    if(!p){ send(res, 404, {ok:false}); return; }
    p.items.forEach(function(it){
      const pr = state.products.find(function(x){ return x.id === it.productId; });
      if(pr){
        const v = (pr.variants||[]).find(function(x){ return x.id === it.variantId; });
        if(v) v.stock = Math.max(0, v.stock - it.qty);
        pr.stock = stockOf(pr);
      }
    });
    state.purchases = state.purchases.filter(function(x){ return x.id !== id; });
    log(req, "حذف فاتورة شراء", p.number);
    saveState();
    send(res, 200, { ok:true, db: dbPayload() });
    return;
  }

  /* ---------- عمليات عامة (إضافة/تعديل/حذف) ---------- */
  const generic = {
    products: { key: "products", addLabel: "إضافة منتج", editLabel: "تعديل منتج", delLabel: "حذف منتج", nameField: "name", logDetail: function(it){ return it.name; } },
    customers: { key: "customers", addLabel: "إضافة عميل", editLabel: "تعديل عميل", delLabel: "حذف عميل", nameField: "name", logDetail: function(it){ return it.name; } },
    suppliers: { key: "suppliers", addLabel: "إضافة مورد", editLabel: "تعديل مورد", delLabel: "حذف مورد", nameField: "name", logDetail: function(it){ return it.name; } },
    expenses: { key: "expenses", addLabel: "مصروف", editLabel: "تعديل مصروف", delLabel: "حذف مصروف", nameField: "note", logDetail: function(it){ return it.note || it.category; } },
    income: { key: "otherIncome", addLabel: "إيراد آخر", editLabel: "تعديل إيراد", delLabel: "حذف إيراد آخر", nameField: "note", logDetail: function(it){ return it.note || ""; } },
    users: { key: "users", addLabel: "إضافة مستخدم", editLabel: "تعديل مستخدم", delLabel: "حذف مستخدم", nameField: "username", logDetail: function(it){ return it.username; } }
  };

  let handled = false;
  Object.keys(generic).forEach(function(g){
    const cfg = generic[g];
    if(handled) return;
    if(method === "POST" && url === "/api/" + g){
      (async function(){
        const b = await readBody(req);
        const it = b.item || {};
        const existing = it.id ? state[cfg.key].find(function(x){ return x.id === it.id; }) : null;
        if(existing){ Object.assign(existing, it); }
        else { it.id = it.id || uid(); state[cfg.key].push(it); }
        // المنتجات: إعادة حساب إجمالي المخزون
        if(cfg.key === "products"){ it.stock = stockOf(it); }
        log(req, existing ? cfg.editLabel : cfg.addLabel, cfg.logDetail(it));
        saveState();
        send(res, 200, { ok:true, db: dbPayload(), item: it });
      })();
      handled = true;
    }
    if(method === "POST" && /^\/api\/[^/]+\/[^/]+\/delete$/.test(url) && url.indexOf("/api/" + g + "/") === 0){
      const id = url.split("/")[3];
      const it = state[cfg.key].find(function(x){ return x.id === id; });
      if(!it){ send(res, 404, {ok:false}); handled = true; return; }
      // حماية: لا يمكن حذف آخر مدير
      if(cfg.key === "users"){
        if(it.id === user.id){ send(res, 400, {ok:false, error:"لا يمكنك حذف حسابك الحالي"}); handled = true; return; }
        if(it.role === "admin" && state.users.filter(function(x){ return x.role==="admin"; }).length <= 1){ send(res, 400, {ok:false, error:"لا يمكن حذف آخر مدير"}); handled = true; return; }
      }
      state[cfg.key] = state[cfg.key].filter(function(x){ return x.id !== id; });
      log(req, cfg.delLabel, cfg.logDetail(it));
      saveState();
      send(res, 200, { ok:true, db: dbPayload() });
      handled = true;
    }
  });
  if(handled) return;

  // مخزون منتج (تعديل كميات المقاسات)
  if(method === "POST" && /^\/api\/products\/[^/]+\/stock$/.test(url)){
    const b = await readBody(req);
    const id = url.split("/")[3];
    const p = state.products.find(function(x){ return x.id === id; });
    if(!p){ send(res, 404, {ok:false}); return; }
    (b.variants||[]).forEach(function(v){
      const vv = (p.variants||[]).find(function(x){ return x.id === v.id; });
      if(vv) vv.stock = Math.max(0, parseInt(v.stock,10)||0);
    });
    p.stock = stockOf(p);
    log(req, "تعديل مخزون", p.name);
    saveState();
    send(res, 200, { ok:true, db: dbPayload() });
    return;
  }

  // الفئات (منتجات ومصاريف)
  if(method === "POST" && url === "/api/categories"){
    const b = await readBody(req);
    if(b.action === "add"){ if(state.categories.indexOf(b.name) === -1) state.categories.push(b.name); log(req, "إضافة فئة", b.name); }
    else { state.categories = state.categories.filter(function(x){ return x !== b.name; }); log(req, "حذف فئة", b.name); }
    saveState();
    send(res, 200, { ok:true, db: dbPayload() });
    return;
  }
  if(method === "POST" && url === "/api/expense-categories"){
    const b = await readBody(req);
    if(b.action === "add"){ if(state.expenseCategories.indexOf(b.name) === -1) state.expenseCategories.push(b.name); }
    else { state.expenseCategories = state.expenseCategories.filter(function(x){ return x !== b.name; }); }
    saveState();
    send(res, 200, { ok:true, db: dbPayload() });
    return;
  }
  if(method === "POST" && url === "/api/shipping-companies"){
    const b = await readBody(req);
    if(b.action === "add"){ state.shippingCompanies.push({ id: uid(), name: b.name, phone:"", notes:"" }); }
    else { state.shippingCompanies = state.shippingCompanies.filter(function(x){ return x.id !== b.id; }); }
    saveState();
    send(res, 200, { ok:true, db: dbPayload() });
    return;
  }
  if(method === "POST" && url === "/api/ship-prices"){
    const b = await readBody(req);
    (b.prices||[]).forEach(function(s){
      const sp = state.shipPrices.find(function(x){ return x.id === s.id; });
      if(sp) sp.price = s.price;
    });
    log(req, "تحديث أسعار الشحن");
    saveState();
    send(res, 200, { ok:true, db: dbPayload() });
    return;
  }

  // الدفعات والتحويلات والإقفالات
  if(method === "POST" && url === "/api/payments/in"){
    const b = await readBody(req);
    const it = b.item || {};
    it.id = it.id || uid();
    it.date = Date.now();
    it.userId = user.id;
    state.paymentsIn.push(it);
    log(req, "قبض دفعة من عميل", it.customerName + " — " + it.amount);
    saveState();
    send(res, 200, { ok:true, db: dbPayload() });
    return;
  }
  if(method === "POST" && url === "/api/payments/out"){
    const b = await readBody(req);
    const it = b.item || {};
    it.id = it.id || uid();
    it.date = Date.now();
    it.userId = user.id;
    state.paymentsOut.push(it);
    log(req, "دفع للمورد", it.supplierName + " — " + it.amount);
    saveState();
    send(res, 200, { ok:true, db: dbPayload() });
    return;
  }
  if(method === "POST" && url === "/api/transfers"){
    const b = await readBody(req);
    const it = b.item || {};
    it.id = it.id || uid();
    it.date = Date.now();
    it.byId = user.id;
    state.transfers.push(it);
    const f = state.users.find(function(x){ return x.id === it.fromId; });
    const t = state.users.find(function(x){ return x.id === it.toId; });
    log(req, "تحويل فلوس", (f?f.name:"") + " ← " + (t?t.name:"") + " — " + it.amount + " " + state.settings.currency);
    saveState();
    send(res, 200, { ok:true, db: dbPayload() });
    return;
  }
  if(method === "POST" && url === "/api/closings"){
    const b = await readBody(req);
    const it = b.item || {};
    const prev = state.cashClosings.find(function(c){ return c.userId === it.userId && c.day === it.day; });
    if(prev){ Object.assign(prev, it); }
    else { it.id = it.id || uid(); it.date = Date.now(); state.cashClosings.push(it); }
    log(req, "إقفال خزنة", it.userName || "");
    saveState();
    send(res, 200, { ok:true, db: dbPayload() });
    return;
  }

  // الإعدادات
  if(method === "POST" && url === "/api/settings"){
    const b = await readBody(req);
    Object.assign(state.settings, b.settings || {});
    log(req, "تحديث الإعدادات");
    saveState();
    send(res, 200, { ok:true, db: dbPayload() });
    return;
  }

  // نسخ احتياطي / استيراد / تصفير
  if(method === "POST" && url === "/api/reset"){
    state = seed();
    log(req, "مسح كل البيانات");
    saveState();
    send(res, 200, { ok:true, db: dbPayload() });
    return;
  }
  if(method === "POST" && url === "/api/import"){
    const b = await readBody(req);
    if(!b.db || !b.db.settings || !b.db.products){ send(res, 400, {ok:false, error:"ملف غير صالح"}); return; }
    state = b.db;
    log(req, "استيراد بيانات");
    saveState();
    send(res, 200, { ok:true, db: dbPayload() });
    return;
  }

  send(res, 404, { ok:false, error: "مسار غير معروف" });
});

(async function(){
  await loadState();
  server.listen(PORT, "0.0.0.0", function(){
    console.log("Server running on port " + PORT + " | data: " + DATA_FILE);
  });
})();
