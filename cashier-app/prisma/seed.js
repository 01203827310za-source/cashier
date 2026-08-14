const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main(){
  const DATA_FILE = path.join(__dirname, '..', 'data', 'db.json');
  if(!fs.existsSync(DATA_FILE)){
    console.error('data/db.json not found — nothing to seed');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));

  // Upsert settings
  if(raw.settings){
    await prisma.setting.upsert({ where: { id: 'main' }, update: { data: raw.settings, data: raw }, create: { id: 'main', data: raw.settings, data: raw } });
  }

  // Users
  if(Array.isArray(raw.users)){
    for(const u of raw.users){
      await prisma.user.upsert({ where: { id: u.id }, update: { name: u.name, username: u.username, password: u.password, role: u.role }, create: { id: u.id, name: u.name, username: u.username, password: u.password, role: u.role } });
    }
  }

  // Categories
  if(Array.isArray(raw.categories)){
    for(const name of raw.categories){
      const id = 'cat_' + Buffer.from(name).toString('hex').slice(0,12);
      await prisma.category.upsert({ where: { id }, update: { name }, create: { id, name } });
    }
  }

  // Products and variants
  if(Array.isArray(raw.products)){
    for(const p of raw.products){
      await prisma.product.upsert({ where: { id: p.id }, update: { name: p.name, category: p.category || null, price: p.price || null, cost: p.cost || null, stock: p.stock || null, sku: p.sku || null, image: p.image || null, offer: p.offer || null, emoji: p.emoji || null }, create: { id: p.id, name: p.name, category: p.category || null, price: p.price || null, cost: p.cost || null, stock: p.stock || null, sku: p.sku || null, image: p.image || null, offer: p.offer || null, emoji: p.emoji || null } });
      if(Array.isArray(p.variants)){
        for(const v of p.variants){
          await prisma.productVariant.upsert({ where: { id: v.id }, update: { productId: p.id, size: v.size || null, color: v.color || null, stock: v.stock || null, barcode: v.barcode || null }, create: { id: v.id, productId: p.id, size: v.size || null, color: v.color || null, stock: v.stock || null, barcode: v.barcode || null } });
        }
      }
    }
  }

  // Customers
  if(Array.isArray(raw.customers)){
    for(const c of raw.customers){
      await prisma.customer.upsert({ where: { id: c.id }, update: { name: c.name, phone: c.phone || null, notes: c.notes || null, createdAt: c.createdAt ? new Date(c.createdAt) : null, addresses: c.addresses || null }, create: { id: c.id, name: c.name, phone: c.phone || null, notes: c.notes || null, createdAt: c.createdAt ? new Date(c.createdAt) : null, addresses: c.addresses || null } });
    }
  }

  // Suppliers
  if(Array.isArray(raw.suppliers)){
    for(const s of raw.suppliers){
      await prisma.supplier.upsert({ where: { id: s.id }, update: { name: s.name, phone: s.phone || null, notes: s.notes || null }, create: { id: s.id, name: s.name, phone: s.phone || null, notes: s.notes || null } });
    }
  }

  // Purchases
  if(Array.isArray(raw.purchases)){
    for(const pu of raw.purchases){
      await prisma.purchase.upsert({ where: { id: pu.id }, update: { number: pu.number || null, date: pu.date ? new Date(pu.date) : null, userId: pu.userId || null, supplierId: pu.supplierId || null, supplierName: pu.supplierName || null, total: pu.total || null }, create: { id: pu.id, number: pu.number || null, date: pu.date ? new Date(pu.date) : null, userId: pu.userId || null, supplierId: pu.supplierId || null, supplierName: pu.supplierName || null, total: pu.total || null } });
      if(Array.isArray(pu.items)){
        for(const it of pu.items){
          const iid = it.id || (pu.id + '_' + Math.random().toString(36).slice(2,9));
          await prisma.purchaseItem.upsert({ where: { id: iid }, update: { purchaseId: pu.id, productId: it.productId || null, variantId: it.variantId || null, qty: it.qty || null, cost: it.cost || null }, create: { id: iid, purchaseId: pu.id, productId: it.productId || null, variantId: it.variantId || null, qty: it.qty || null, cost: it.cost || null } });
        }
      }
    }
  }

  // Sales
  if(Array.isArray(raw.sales)){
    for(const s of raw.sales){
      await prisma.sale.upsert({ where: { id: s.id }, update: { number: s.number || null, date: s.date ? new Date(s.date) : null, userId: s.userId || null, total: s.total || null }, create: { id: s.id, number: s.number || null, date: s.date ? new Date(s.date) : null, userId: s.userId || null, total: s.total || null } });
      if(Array.isArray(s.items)){
        for(const it of s.items){
          const iid = it.id || (s.id + '_' + Math.random().toString(36).slice(2,9));
          await prisma.saleItem.upsert({ where: { id: iid }, update: { saleId: s.id, productId: it.productId || null, variantId: it.variantId || null, price: it.price || null, qty: it.qty || null, size: it.size || null, color: it.color || null }, create: { id: iid, saleId: s.id, productId: it.productId || null, variantId: it.variantId || null, price: it.price || null, qty: it.qty || null, size: it.size || null, color: it.color || null } });
        }
      }
    }
  }

  // Shipping companies
  if(Array.isArray(raw.shippingCompanies)){
    for(const sc of raw.shippingCompanies){
      await prisma.shippingCompany.upsert({ where: { id: sc.id }, update: { name: sc.name || null, phone: sc.phone || null, notes: sc.notes || null }, create: { id: sc.id, name: sc.name || null, phone: sc.phone || null, notes: sc.notes || null } });
    }
  }

  // Ship prices
  if(Array.isArray(raw.shipPrices)){
    for(const sp of raw.shipPrices){
      await prisma.shippingPrice.upsert({ where: { id: sp.id }, update: { governorate: sp.governorate || null, price: sp.price || null }, create: { id: sp.id, governorate: sp.governorate || null, price: sp.price || null } });
    }
  }

  // Orders
  if(Array.isArray(raw.orders)){
    for(const o of raw.orders){
      await prisma.order.upsert({ where: { id: o.id }, update: { number: o.number || null, date: o.date ? new Date(o.date) : null, userId: o.userId || null, customerName: o.customerName || null, total: o.total || null, status: o.status || null }, create: { id: o.id, number: o.number || null, date: o.date ? new Date(o.date) : null, userId: o.userId || null, customerName: o.customerName || null, total: o.total || null, status: o.status || null } });
      if(Array.isArray(o.items)){
        for(const it of o.items){
          const iid = it.id || (o.id + '_' + Math.random().toString(36).slice(2,9));
          await prisma.orderItem.upsert({ where: { id: iid }, update: { orderId: o.id, productId: it.productId || null, variantId: it.variantId || null, qty: it.qty || null, price: it.price || null }, create: { id: iid, orderId: o.id, productId: it.productId || null, variantId: it.variantId || null, qty: it.qty || null, price: it.price || null } });
        }
      }
    }
  }

  // Expense categories
  if(Array.isArray(raw.expenseCategories)){
    for(const name of raw.expenseCategories){
      const id = 'expcat_' + Buffer.from(name).toString('hex').slice(0,12);
      await prisma.expenseCategory.upsert({ where: { id }, update: { name }, create: { id, name } });
    }
  }

  // Expenses
  if(Array.isArray(raw.expenses)){
    for(const ex of raw.expenses){
      await prisma.expense.upsert({ where: { id: ex.id }, update: { category: ex.category || null, amount: ex.amount || null, date: ex.date ? new Date(ex.date) : null, note: ex.note || null, userId: ex.userId || null }, create: { id: ex.id, category: ex.category || null, amount: ex.amount || null, date: ex.date ? new Date(ex.date) : null, note: ex.note || null, userId: ex.userId || null } });
    }
  }

  // Other income
  if(Array.isArray(raw.otherIncome)){
    for(const oi of raw.otherIncome){
      await prisma.otherIncome.upsert({ where: { id: oi.id }, update: { note: oi.note || null, amount: oi.amount || null, date: oi.date ? new Date(oi.date) : null, userId: oi.userId || null }, create: { id: oi.id, note: oi.note || null, amount: oi.amount || null, date: oi.date ? new Date(oi.date) : null, userId: oi.userId || null } });
    }
  }

  // Payments In
  if(Array.isArray(raw.paymentsIn)){
    for(const pi of raw.paymentsIn){
      await prisma.paymentIn.upsert({ where: { id: pi.id }, update: { customerName: pi.customerName || null, amount: pi.amount || null, date: pi.date ? new Date(pi.date) : null, userId: pi.userId || null }, create: { id: pi.id, customerName: pi.customerName || null, amount: pi.amount || null, date: pi.date ? new Date(pi.date) : null, userId: pi.userId || null } });
    }
  }

  // Payments Out
  if(Array.isArray(raw.paymentsOut)){
    for(const po of raw.paymentsOut){
      await prisma.paymentOut.upsert({ where: { id: po.id }, update: { supplierName: po.supplierName || null, amount: po.amount || null, date: po.date ? new Date(po.date) : null, userId: po.userId || null }, create: { id: po.id, supplierName: po.supplierName || null, amount: po.amount || null, date: po.date ? new Date(po.date) : null, userId: po.userId || null } });
    }
  }

  // Cash closings
  if(Array.isArray(raw.cashClosings)){
    for(const cc of raw.cashClosings){
      await prisma.cashClosing.upsert({ where: { id: cc.id }, update: { userId: cc.userId || null, day: cc.day || null, date: cc.date ? new Date(cc.date) : null, data: cc }, create: { id: cc.id, userId: cc.userId || null, day: cc.day || null, date: cc.date ? new Date(cc.date) : null, data: cc } });
    }
  }

  // Transfers
  if(Array.isArray(raw.transfers)){
    for(const t of raw.transfers){
      await prisma.transfer.upsert({ where: { id: t.id }, update: { fromId: t.fromId || null, toId: t.toId || null, amount: t.amount || null, date: t.date ? new Date(t.date) : null, byId: t.byId || null }, create: { id: t.id, fromId: t.fromId || null, toId: t.toId || null, amount: t.amount || null, date: t.date ? new Date(t.date) : null, byId: t.byId || null } });
    }
  }

  // Audit
  if(Array.isArray(raw.audit)){
    for(const a of raw.audit){
      await prisma.auditLog.upsert({ where: { id: a.id }, update: { date: a.date ? new Date(a.date) : null, userId: a.userId || null, userName: a.userName || null, action: a.action || null, detail: a.detail || null }, create: { id: a.id, date: a.date ? new Date(a.date) : null, userId: a.userId || null, userName: a.userName || null, action: a.action || null, detail: a.detail || null } });
    }
  }

  // Save full raw state snapshot
  await prisma.rawState.upsert({ where: { id: 'main' }, update: { data: raw }, create: { id: 'main', data: raw } });

  console.log('Seed/import completed');
}

main().catch(function(e){ console.error(e); process.exit(1); }).finally(async function(){ await prisma.$disconnect(); });
