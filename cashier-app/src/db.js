const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

/**
 * Derives a model code for a product that doesn't already have one, preferring
 * its existing SKU (if non-empty and not already claimed) and otherwise
 * generating a clearly-marked fallback — never silently reusing another
 * product's code. `usedCodesLower` is a Set of already-claimed codes
 * (lowercased) that this call both checks against and adds to.
 */
function deriveModelCode(product, usedCodesLower){
  const sku = (product.sku || "").trim();
  if (sku && !usedCodesLower.has(sku.toLowerCase())) {
    usedCodesLower.add(sku.toLowerCase());
    return sku;
  }
  const base = "MC-" + String(product.id || uid()).slice(-6).toUpperCase();
  let candidate = base;
  let n = 2;
  while (usedCodesLower.has(candidate.toLowerCase())) {
    candidate = base + "-" + n;
    n++;
  }
  usedCodesLower.add(candidate.toLowerCase());
  return candidate;
}

async function buildStateFromDB(){
  // Compose the full `state` object the frontend expects, entirely from Postgres.
  const state = {};

  const setting = await prisma.setting.findUnique({ where: { id: 'main' } });
  state.settings = setting ? (setting.data || {
    storeName: setting.storeName,
    currency: setting.currency,
    taxRate: setting.taxRate,
    lowStockThreshold: setting.lowStockThreshold,
    invoicePrefix: setting.invoicePrefix,
    invoiceCounter: setting.invoiceCounter,
    purchaseCounter: setting.purchaseCounter,
    orderCounter: setting.orderCounter,
    receiptFooter: setting.receiptFooter,
    phone: setting.phone
  }) : {};

  state.users = await prisma.user.findMany();

  const cats = await prisma.category.findMany();
  state.categories = cats.map(c => c.name);

  const products = await prisma.product.findMany({ include: { variants: true } });
  state.products = products.map(p => {
    const sizes = Array.from(new Set((p.variants || []).map(v => v.size).filter(x => x != null)));
    const colors = Array.from(new Set((p.variants || []).map(v => v.color).filter(x => x != null)));
    return {
      ...(p.data || {}),
      id: p.id, name: p.name, category: p.category, price: p.price, cost: p.cost, stock: p.stock,
      sizes: sizes, colors: colors, sku: p.sku, modelCode: p.modelCode, emoji: p.emoji, image: p.image || "",
      offer: (p.data && Object.prototype.hasOwnProperty.call(p.data, 'offer')) ? p.data.offer : null,
      variants: (p.variants || []).map(v => ({ id: v.id, size: v.size, color: v.color, stock: v.stock, barcode: v.barcode }))
    };
  });

  const customers = await prisma.customer.findMany();
  state.customers = customers.map(c => ({ id: c.id, name: c.name, phone: c.phone, notes: c.notes, createdAt: c.createdAt ? c.createdAt.getTime() : null, addresses: c.addresses || [] }));

  state.suppliers = await prisma.supplier.findMany();

  const purchases = await prisma.purchase.findMany({ include: { items: true } });
  state.purchases = purchases.map(pu => ({
    ...(pu.data || {}),
    id: pu.id, number: pu.number, date: pu.date ? pu.date.getTime() : null, userId: pu.userId,
    supplierId: pu.supplierId, supplierName: pu.supplierName, total: pu.total,
    type: pu.type || "goods", paid: pu.paid, remaining: pu.remaining, paymentStatus: pu.paymentStatus,
    paymentMethod: pu.paymentMethod, notes: pu.notes,
    items: (pu.items || []).map(it => ({ ...(it.data || {}), id: it.id, productId: it.productId, variantId: it.variantId, qty: it.qty, cost: it.cost }))
  }));

  state.purchasePayments = (await prisma.purchasePayment.findMany()).map(p => ({
    ...(p.data || {}), id: p.id, purchaseId: p.purchaseId, supplierId: p.supplierId, supplierName: p.supplierName,
    date: p.date ? p.date.getTime() : null, amount: p.amount, paymentMethod: p.paymentMethod, notes: p.notes, userId: p.userId, partner: p.partner
  }));

  const sales = await prisma.sale.findMany({ include: { items: true } });
  state.sales = sales.map(s => ({
    ...(s.data || {}),
    id: s.id, number: s.number, date: s.date ? s.date.getTime() : null, userId: s.userId, total: s.total,
    items: (s.items || []).map(it => ({ ...(it.data || {}), id: it.id, productId: it.productId, variantId: it.variantId, price: it.price, qty: it.qty, size: it.size, color: it.color }))
  }));

  state.shippingCompanies = await prisma.shippingCompany.findMany();
  const shipPrices = await prisma.shippingPrice.findMany();
  state.shipPrices = shipPrices.map(sp => ({ id: sp.id, governorate: sp.governorate, price: sp.price }));

  const orders = await prisma.order.findMany({ include: { items: true } });
  state.orders = orders.map(o => ({
    ...(o.data || {}),
    id: o.id, number: o.number, date: o.date ? o.date.getTime() : null, userId: o.userId,
    customerName: o.customerName, total: o.total, status: o.status,
    deposit: o.deposit, collectedTotal: o.collectedTotal, remaining: o.remaining, collectionStatus: o.collectionStatus,
    items: (o.items || []).map(it => ({ ...(it.data || {}), id: it.id, productId: it.productId, variantId: it.variantId, qty: it.qty, price: it.price }))
  }));

  state.orderCollections = (await prisma.orderCollection.findMany()).map(c => ({
    ...(c.data || {}), id: c.id, orderId: c.orderId, kind: c.kind, amount: c.amount,
    date: c.date ? c.date.getTime() : null, paymentMethod: c.paymentMethod, partner: c.partner, notes: c.notes, userId: c.userId
  }));

  const returns = await prisma.saleReturn.findMany({ include: { items: true } });
  state.returns = returns.map(r => ({
    ...(r.data || {}),
    id: r.id, number: r.number, type: r.type, saleId: r.saleId, customerId: r.customerId, userId: r.userId,
    date: r.date ? r.date.getTime() : null, reason: r.reason, status: r.status, refundMethod: r.refundMethod,
    returnedTotal: r.returnedTotal, replacementTotal: r.replacementTotal, difference: r.difference,
    items: (r.items || []).map(it => ({
      ...(it.data || {}), id: it.id, saleItemId: it.saleItemId, productId: it.productId, variantId: it.variantId,
      modelCode: it.modelCode, size: it.size, color: it.color, qty: it.qty, unitPrice: it.unitPrice, lineTotal: it.lineTotal,
      condition: it.condition, replacementProductId: it.replacementProductId, replacementVariantId: it.replacementVariantId,
      replacementQty: it.replacementQty, replacementPrice: it.replacementPrice
    }))
  }));

  const expCats = await prisma.expenseCategory.findMany();
  state.expenseCategories = expCats.map(e => e.name);

  state.expenses = (await prisma.expense.findMany()).map(e => ({ ...(e.data || {}), id: e.id, category: e.category, amount: e.amount, date: e.date ? e.date.getTime() : null, note: e.note, userId: e.userId, partner: e.partner }));
  state.otherIncome = (await prisma.otherIncome.findMany()).map(o => ({ ...(o.data || {}), id: o.id, note: o.note, amount: o.amount, date: o.date ? o.date.getTime() : null, userId: o.userId, partner: o.partner }));
  state.paymentsIn = (await prisma.paymentIn.findMany()).map(p => ({ ...(p.data || {}), id: p.id, customerName: p.customerName, amount: p.amount, date: p.date ? p.date.getTime() : null, userId: p.userId }));
  state.paymentsOut = (await prisma.paymentOut.findMany()).map(p => ({ ...(p.data || {}), id: p.id, supplierName: p.supplierName, amount: p.amount, date: p.date ? p.date.getTime() : null, userId: p.userId, partner: p.partner }));
  state.cashClosings = (await prisma.cashClosing.findMany()).map(c => ({ ...(c.data || {}), id: c.id, userId: c.userId, day: c.day, date: c.date ? c.date.getTime() : null }));
  state.transfers = (await prisma.transfer.findMany()).map(t => ({ id: t.id, fromId: t.fromId, toId: t.toId, amount: t.amount, date: t.date ? t.date.getTime() : null, byId: t.byId }));
  state.audit = (await prisma.auditLog.findMany({ orderBy: { date: 'asc' } })).map(a => ({ id: a.id, date: a.date ? a.date.getTime() : null, userId: a.userId, userName: a.userName, action: a.action, detail: a.detail }));

  state.partnerTransactions = (await prisma.partnerTransaction.findMany({ orderBy: { date: 'asc' } })).map(t => ({
    id: t.id, partner: t.partner, type: t.type, direction: t.direction, amount: t.amount,
    referenceType: t.referenceType, referenceId: t.referenceId, date: t.date ? t.date.getTime() : null,
    userId: t.userId, notes: t.notes
  }));

  // Ensure arrays exist for compatibility
  ["users", "categories", "products", "customers", "suppliers", "purchases", "purchasePayments", "audit", "sales", "returns",
   "shippingCompanies", "shipPrices", "orders", "orderCollections", "expenseCategories", "expenses", "otherIncome",
   "paymentsIn", "paymentsOut", "cashClosings", "transfers", "partnerTransactions"].forEach(function (k) { if (!state[k]) state[k] = []; });

  return state;
}

async function trimAuditLog(limit){
  limit = limit || 3000;
  const total = await prisma.auditLog.count();
  if (total > limit) {
    const toRemove = await prisma.auditLog.findMany({ orderBy: { date: 'asc' }, take: total - limit, select: { id: true } });
    if (toRemove.length) {
      await prisma.auditLog.deleteMany({ where: { id: { in: toRemove.map(r => r.id) } } });
    }
  }
}

async function replaceStateInDB(raw){
  raw = raw || {};
  const created = await prisma.$transaction(async (tx) => {
    let count = 0;

    // Wipe everything. Product/Sale/Purchase/Order cascade-delete their item rows.
    // SaleReturn must go first — it references Sale without a cascade delete
    // (returns are never allowed to silently vanish just because someone wipes
    // the sale, so this is the one relation that isn't onDelete:Cascade).
    // PurchasePayment must go before Purchase for the same reason.
    await tx.saleReturn.deleteMany({});
    await tx.purchasePayment.deleteMany({});
    await tx.orderCollection.deleteMany({});
    await tx.partnerTransaction.deleteMany({});
    await tx.product.deleteMany({});
    await tx.sale.deleteMany({});
    await tx.purchase.deleteMany({});
    await tx.order.deleteMany({});
    await tx.category.deleteMany({});
    await tx.customer.deleteMany({});
    await tx.supplier.deleteMany({});
    await tx.shippingCompany.deleteMany({});
    await tx.shippingPrice.deleteMany({});
    await tx.expenseCategory.deleteMany({});
    await tx.expense.deleteMany({});
    await tx.otherIncome.deleteMany({});
    await tx.paymentIn.deleteMany({});
    await tx.paymentOut.deleteMany({});
    await tx.cashClosing.deleteMany({});
    await tx.transfer.deleteMany({});
    await tx.auditLog.deleteMany({});
    await tx.user.deleteMany({});
    await tx.setting.deleteMany({});

    const settings = raw.settings || {};
    await tx.setting.create({
      data: {
        id: 'main', storeName: settings.storeName || null, currency: settings.currency || null, taxRate: settings.taxRate != null ? settings.taxRate : null,
        lowStockThreshold: settings.lowStockThreshold != null ? settings.lowStockThreshold : null, invoicePrefix: settings.invoicePrefix || null,
        invoiceCounter: settings.invoiceCounter != null ? settings.invoiceCounter : null, purchaseCounter: settings.purchaseCounter != null ? settings.purchaseCounter : null,
        orderCounter: settings.orderCounter != null ? settings.orderCounter : null, returnCounter: settings.returnCounter != null ? settings.returnCounter : null,
        receiptFooter: settings.receiptFooter || null, phone: settings.phone || null,
        data: settings
      }
    });
    count++;

    for (const u of (raw.users || [])) {
      await tx.user.create({ data: { id: u.id, name: u.name || null, username: u.username, password: u.password, role: u.role || null, canManageReturns: u.canManageReturns === false ? false : true } });
      count++;
    }
    for (const name of (raw.categories || [])) {
      await tx.category.create({ data: { id: uid(), name } });
      count++;
    }
    const usedModelCodes = new Set();
    (raw.products || []).forEach(function (p) {
      const mc = (p.modelCode || "").trim();
      if (mc) usedModelCodes.add(mc.toLowerCase());
    });
    for (const p of (raw.products || [])) {
      const modelCode = (p.modelCode && p.modelCode.trim()) ? p.modelCode.trim() : deriveModelCode(p, usedModelCodes);
      await tx.product.create({
        data: {
          id: p.id, name: p.name, category: p.category || null, price: p.price != null ? p.price : null, cost: p.cost != null ? p.cost : null,
          stock: p.stock != null ? p.stock : null, sku: p.sku || null, modelCode: modelCode, image: p.image || null, emoji: p.emoji || null, data: p,
          variants: { create: (p.variants || []).map(v => ({ id: v.id || uid(), size: v.size || null, color: v.color || null, stock: v.stock != null ? v.stock : null, barcode: v.barcode || null })) }
        }
      });
      count += 1 + (p.variants || []).length;
    }
    for (const c of (raw.customers || [])) {
      await tx.customer.create({ data: { id: c.id, name: c.name, phone: c.phone || null, notes: c.notes || null, createdAt: c.createdAt ? new Date(c.createdAt) : null, addresses: c.addresses || [] } });
      count++;
    }
    for (const s of (raw.suppliers || [])) {
      await tx.supplier.create({ data: { id: s.id, name: s.name, phone: s.phone || null, notes: s.notes || null } });
      count++;
    }
    for (const pu of (raw.purchases || [])) {
      await tx.purchase.create({
        data: {
          id: pu.id, number: pu.number || null, date: pu.date ? new Date(pu.date) : null, userId: pu.userId || null,
          supplierId: pu.supplierId || null, supplierName: pu.supplierName || null, total: pu.total != null ? pu.total : null,
          type: pu.type || "goods", paid: pu.paid != null ? pu.paid : null, remaining: pu.remaining != null ? pu.remaining : null,
          paymentStatus: pu.paymentStatus || null, paymentMethod: pu.paymentMethod || null, notes: pu.notes || null, data: pu,
          items: { create: (pu.items || []).map(it => ({ id: it.id || uid(), productId: it.productId || null, variantId: it.variantId || null, qty: it.qty != null ? it.qty : null, cost: it.cost != null ? it.cost : null, data: it })) }
        }
      });
      count += 1 + (pu.items || []).length;
    }
    for (const pp of (raw.purchasePayments || [])) {
      await tx.purchasePayment.create({
        data: {
          id: pp.id || uid(), purchaseId: pp.purchaseId, supplierId: pp.supplierId || null, supplierName: pp.supplierName || null,
          date: pp.date ? new Date(pp.date) : null, amount: pp.amount != null ? pp.amount : null, paymentMethod: pp.paymentMethod || null,
          notes: pp.notes || null, userId: pp.userId || null, partner: pp.partner || null, data: pp
        }
      });
      count++;
    }
    for (const s of (raw.sales || [])) {
      await tx.sale.create({
        data: {
          id: s.id, number: s.number || null, date: s.date ? new Date(s.date) : null, userId: s.userId || null, total: s.total != null ? s.total : null, data: s,
          items: { create: (s.items || []).map(it => ({ id: it.id || uid(), productId: it.productId || null, variantId: it.variantId || null, price: it.price != null ? it.price : null, qty: it.qty != null ? it.qty : null, size: it.size || null, color: it.color || null, data: it })) }
        }
      });
      count += 1 + (s.items || []).length;
    }
    for (const r of (raw.returns || [])) {
      await tx.saleReturn.create({
        data: {
          id: r.id, number: r.number || null, type: r.type || null, saleId: r.saleId, customerId: r.customerId || null,
          userId: r.userId || null, date: r.date ? new Date(r.date) : null, reason: r.reason || null, status: r.status || null,
          refundMethod: r.refundMethod || null, returnedTotal: r.returnedTotal != null ? r.returnedTotal : null,
          replacementTotal: r.replacementTotal != null ? r.replacementTotal : null, difference: r.difference != null ? r.difference : null,
          data: r,
          items: { create: (r.items || []).map(it => ({
            id: it.id || uid(), saleItemId: it.saleItemId, productId: it.productId || null, variantId: it.variantId || null,
            modelCode: it.modelCode || null, size: it.size || null, color: it.color || null, qty: it.qty != null ? it.qty : null,
            unitPrice: it.unitPrice != null ? it.unitPrice : null, lineTotal: it.lineTotal != null ? it.lineTotal : null,
            condition: it.condition || null, replacementProductId: it.replacementProductId || null, replacementVariantId: it.replacementVariantId || null,
            replacementQty: it.replacementQty != null ? it.replacementQty : null, replacementPrice: it.replacementPrice != null ? it.replacementPrice : null,
            data: it
          })) }
        }
      });
      count += 1 + (r.items || []).length;
    }
    for (const sc of (raw.shippingCompanies || [])) {
      await tx.shippingCompany.create({ data: { id: sc.id, name: sc.name || null, phone: sc.phone || null, notes: sc.notes || null } });
      count++;
    }
    for (const sp of (raw.shipPrices || [])) {
      await tx.shippingPrice.create({ data: { id: sp.id, governorate: sp.governorate || null, price: sp.price != null ? sp.price : null } });
      count++;
    }
    for (const o of (raw.orders || [])) {
      await tx.order.create({
        data: {
          id: o.id, number: o.number || null, date: o.date ? new Date(o.date) : null, userId: o.userId || null,
          customerName: o.customerName || null, total: o.total != null ? o.total : null, status: o.status || null,
          deposit: o.deposit != null ? o.deposit : null, collectedTotal: o.collectedTotal != null ? o.collectedTotal : null,
          remaining: o.remaining != null ? o.remaining : null, collectionStatus: o.collectionStatus || null, data: o,
          items: { create: (o.items || []).map(it => ({ id: it.id || uid(), productId: it.productId || null, variantId: it.variantId || null, qty: it.qty != null ? it.qty : null, price: it.price != null ? it.price : null, data: it })) }
        }
      });
      count += 1 + (o.items || []).length;
    }
    for (const oc of (raw.orderCollections || [])) {
      await tx.orderCollection.create({
        data: {
          id: oc.id || uid(), orderId: oc.orderId, kind: oc.kind || null, amount: oc.amount != null ? oc.amount : null,
          date: oc.date ? new Date(oc.date) : null, paymentMethod: oc.paymentMethod || null, partner: oc.partner || null,
          notes: oc.notes || null, userId: oc.userId || null, data: oc
        }
      });
      count++;
    }
    for (const name of (raw.expenseCategories || [])) {
      await tx.expenseCategory.create({ data: { id: uid(), name } });
      count++;
    }
    for (const ex of (raw.expenses || [])) {
      await tx.expense.create({ data: { id: ex.id, category: ex.category || null, amount: ex.amount != null ? ex.amount : null, date: ex.date ? new Date(ex.date) : null, note: ex.note || null, userId: ex.userId || null, partner: ex.partner || null, data: ex } });
      count++;
    }
    for (const oi of (raw.otherIncome || [])) {
      await tx.otherIncome.create({ data: { id: oi.id, note: oi.note || null, amount: oi.amount != null ? oi.amount : null, date: oi.date ? new Date(oi.date) : null, userId: oi.userId || null, partner: oi.partner || null, data: oi } });
      count++;
    }
    for (const pi of (raw.paymentsIn || [])) {
      await tx.paymentIn.create({ data: { id: pi.id, customerName: pi.customerName || null, amount: pi.amount != null ? pi.amount : null, date: pi.date ? new Date(pi.date) : null, userId: pi.userId || null, data: pi } });
      count++;
    }
    for (const po of (raw.paymentsOut || [])) {
      await tx.paymentOut.create({ data: { id: po.id, supplierName: po.supplierName || null, amount: po.amount != null ? po.amount : null, date: po.date ? new Date(po.date) : null, userId: po.userId || null, partner: po.partner || null, data: po } });
      count++;
    }
    for (const cc of (raw.cashClosings || [])) {
      await tx.cashClosing.create({ data: { id: cc.id || uid(), userId: cc.userId || null, day: cc.day || null, date: cc.date ? new Date(cc.date) : null, data: cc } });
      count++;
    }
    for (const t of (raw.transfers || [])) {
      await tx.transfer.create({ data: { id: t.id, fromId: t.fromId || null, toId: t.toId || null, amount: t.amount != null ? t.amount : null, date: t.date ? new Date(t.date) : null, byId: t.byId || null } });
      count++;
    }
    for (const a of (raw.audit || [])) {
      await tx.auditLog.create({ data: { id: a.id || uid(), date: a.date ? new Date(a.date) : null, userId: a.userId || null, userName: a.userName || null, action: a.action || null, detail: a.detail || null } });
      count++;
    }
    for (const pt of (raw.partnerTransactions || [])) {
      await tx.partnerTransaction.create({ data: {
        id: pt.id || uid(), partner: pt.partner, type: pt.type || null, direction: pt.direction || null, amount: pt.amount != null ? pt.amount : null,
        referenceType: pt.referenceType || null, referenceId: pt.referenceId || null, date: pt.date ? new Date(pt.date) : null,
        userId: pt.userId || null, notes: pt.notes || null, data: pt
      }});
      count++;
    }

    return count;
  }, { timeout: 60000, maxWait: 15000 });

  return created;
}

/**
 * Confirms the DB is reachable, seeds it exactly once if empty, then logs
 * row counts for a few key tables so a bad/incomplete seed is visible in
 * the deploy logs immediately instead of surfacing later as a UI bug.
 * Throws on failure — the caller decides whether/how to keep the process alive.
 */
async function initializeDatabase(seedData){
  const userCount = await prisma.user.count();
  console.log('Database connected');

  if (userCount === 0) {
    console.log('Database empty, starting seed');
    const recordsCreated = await replaceStateInDB(seedData);
    console.log('Seed completed successfully — records created: ' + recordsCreated);
  } else {
    console.log('Database already has data (' + userCount + ' users) — skipping seed');
  }

  const counts = {
    users: await prisma.user.count(),
    products: await prisma.product.count(),
    customers: await prisma.customer.count(),
    sales: await prisma.sale.count()
  };
  console.log('Startup verification — users: ' + counts.users + ', products: ' + counts.products + ', customers: ' + counts.customers + ', sales: ' + counts.sales);
  return counts;
}

module.exports = { prisma, buildStateFromDB, replaceStateInDB, initializeDatabase, trimAuditLog, deriveModelCode };
