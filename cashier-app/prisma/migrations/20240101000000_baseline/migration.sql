-- Baseline migration: records the schema as it already exists on the live
-- Railway database (everything this project created via `prisma db push`
-- before Prisma Migrate was introduced). This file is NOT executed against
-- Railway — it is marked as already-applied via:
--   npx prisma migrate resolve --applied 20240101000000_baseline
-- so Prisma Migrate stops trying to (re)create tables that are already
-- there, and can take over managing the schema from this point forward.
-- (Product.modelCode is intentionally NOT included here — it did not exist
-- yet at baseline time; it is introduced safely by the next migration.)

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "price" DOUBLE PRECISION,
    "cost" DOUBLE PRECISION,
    "stock" INTEGER,
    "sku" TEXT,
    "image" TEXT,
    "offer" TEXT,
    "emoji" TEXT,
    "data" JSONB,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "size" TEXT,
    "color" TEXT,
    "stock" INTEGER,
    "barcode" TEXT,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3),
    "addresses" JSONB,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "date" TIMESTAMP(3),
    "userId" TEXT,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "total" DOUBLE PRECISION,
    "data" JSONB,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "qty" INTEGER,
    "cost" DOUBLE PRECISION,
    "data" JSONB,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "date" TIMESTAMP(3),
    "userId" TEXT,
    "total" DOUBLE PRECISION,
    "data" JSONB,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "price" DOUBLE PRECISION,
    "qty" INTEGER,
    "size" TEXT,
    "color" TEXT,
    "data" JSONB,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingCompany" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,

    CONSTRAINT "ShippingCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingPrice" (
    "id" TEXT NOT NULL,
    "governorate" TEXT NOT NULL,
    "price" DOUBLE PRECISION,

    CONSTRAINT "ShippingPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "date" TIMESTAMP(3),
    "userId" TEXT,
    "customerName" TEXT,
    "total" DOUBLE PRECISION,
    "status" TEXT,
    "data" JSONB,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "qty" INTEGER,
    "price" DOUBLE PRECISION,
    "data" JSONB,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "category" TEXT,
    "amount" DOUBLE PRECISION,
    "date" TIMESTAMP(3),
    "note" TEXT,
    "userId" TEXT,
    "data" JSONB,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtherIncome" (
    "id" TEXT NOT NULL,
    "note" TEXT,
    "amount" DOUBLE PRECISION,
    "date" TIMESTAMP(3),
    "userId" TEXT,
    "data" JSONB,

    CONSTRAINT "OtherIncome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentIn" (
    "id" TEXT NOT NULL,
    "customerName" TEXT,
    "amount" DOUBLE PRECISION,
    "date" TIMESTAMP(3),
    "userId" TEXT,
    "data" JSONB,

    CONSTRAINT "PaymentIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentOut" (
    "id" TEXT NOT NULL,
    "supplierName" TEXT,
    "amount" DOUBLE PRECISION,
    "date" TIMESTAMP(3),
    "userId" TEXT,
    "data" JSONB,

    CONSTRAINT "PaymentOut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashClosing" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "day" TEXT,
    "date" TIMESTAMP(3),
    "data" JSONB,

    CONSTRAINT "CashClosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "fromId" TEXT,
    "toId" TEXT,
    "amount" DOUBLE PRECISION,
    "date" TIMESTAMP(3),
    "byId" TEXT,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "userId" TEXT,
    "userName" TEXT,
    "action" TEXT,
    "detail" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "storeName" TEXT,
    "currency" TEXT,
    "taxRate" DOUBLE PRECISION,
    "lowStockThreshold" INTEGER,
    "invoicePrefix" TEXT,
    "invoiceCounter" INTEGER,
    "purchaseCounter" INTEGER,
    "orderCounter" INTEGER,
    "receiptFooter" TEXT,
    "phone" TEXT,
    "data" JSONB,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawState" (
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "RawState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
