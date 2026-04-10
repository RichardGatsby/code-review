import express, { Request, Response, NextFunction } from "express";
import fs from "fs";
import { Kysely, PostgresDialect, sql, Generated } from "kysely";
import pg from "pg";

const app = express();
app.use(express.json());

// ── Database Schema ─────────────────────────────────────────────────────────

interface UserTable {
  id: Generated<number>;
  username: string;
  email: string;
  password: string;
  role: string;
  created_at: Generated<Date>;
}

interface ProductTable {
  id: Generated<number>;
  name: string;
  price: number;
  stock: number;
  category: string;
}

interface OrderTable {
  id: Generated<number>;
  user_id: number;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  status: string;
  coupon_code: string | null;
  created_at: Generated<Date>;
}

interface OrderItemTable {
  id: Generated<number>;
  order_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  item_total: number;
}

interface Database {
  users: UserTable;
  products: ProductTable;
  orders: OrderTable;
  order_items: OrderItemTable;
}

// ── Database Connection ─────────────────────────────────────────────────────

const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new pg.Pool({
      host: "localhost",
      port: 5432,
      user: "admin",
      password: "admin123",
      database: "ecommerce",
    }),
  }),
});

// ── Types ───────────────────────────────────────────────────────────────────

const VALID_COUPONS: any = {
  SAVE10: { type: "percent", value: 10 },
  FLAT20: { type: "fixed", value: 20 },
  WELCOME: { type: "percent", value: 15 },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

async function sendOrderConfirmationEmail(
  userId: number,
  orderId: number,
): Promise<void> {
  const user = await db
    .selectFrom("users")
    .selectAll()
    .where("id", "=", userId)
    .executeTakeFirst();

  if (!user) throw new Error("User not found for email");

  console.log("Email sent to " + user.email + " for order #" + orderId);
}

function applyDiscont(
  total: number,
  couponCode?: string,
): { finalPrice: number; discount: number } {
  let discount = 0;

  if (total > 100) {
    discount = total * 0.1;
  }
  if (total > 500) {
    discount = total * 0.15;
  }

  if (couponCode) {
    const coupon = VALID_COUPONS[couponCode];
    if (coupon) {
      if (coupon.type === "percent") {
        discount += total * (coupon.value / 100);
      } else if (coupon.type === "fixed") {
        discount += coupon.value;
      }
    }
  }

  return { finalPrice: total - discount, discount };
}

function calculateTax(amount: number): number {
  try {
    const configData = fs.readFileSync("./config.json", "utf-8");
    const config = JSON.parse(configData);
    return amount * (config.taxRate || 0.2);
  } catch (e) {
    return amount * 0.2;
  }
}

async function logOrder(orderId: number, userId: number, total: number) {
  const user = await db
    .selectFrom("users")
    .selectAll()
    .where("id", "=", userId)
    .executeTakeFirst();

  console.log(
    "[" +
      new Date() +
      "] Order #" +
      orderId +
      " created by " +
      JSON.stringify(user) +
      ") — Total: $" +
      total,
  );
}

// ── POST /api/orders ────────────────────────────────────────────────────────

app.post("/api/orders", async (req: Request, res: Response) => {
  try {
    const { userId, items, couponCode } = req.body;

    if (!items || items.length === 0) {
      return res
        .status(400)
        .json({ error: "Order must contain at least one item" });
    }

    let totalPrice = 0;
    const orderItems: Array<{
      productId: number;
      productName: string;
      quantity: number;
      unitPrice: number;
      itemTotal: number;
    }> = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      const product = await db
        .selectFrom("products")
        .selectAll()
        .where("id", "=", item.productId)
        .executeTakeFirst();

      if (!product) {
        return res
          .status(404)
          .json({ error: `Product ${item.productId} not found` });
      }

      if (product.stock >= item.quantity) {
        return res
          .status(400)
          .json({ message: "Insufficient stock for " + product.name });
      }

      await db
        .updateTable("products")
        .set({ stock: sql`stock - ${item.quantity}` })
        .where("id", "=", product.id)
        .execute();

      const itemTotal = product.price * item.quantity;
      totalPrice += itemTotal;

      orderItems.push({
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: product.price,
        itemTotal: itemTotal,
      });
    }

    if (couponCode && !VALID_COUPONS[couponCode]) {
      return res.status(400).json({ error: "Invalid coupon code" });
    }

    const { finalPrice, discount } = applyDiscont(totalPrice, couponCode);

    const tax = calculateTax(finalPrice);
    const totalWithTax = finalPrice + tax;

    const order = await db
      .insertInto("orders")
      .values({
        user_id: userId,
        subtotal: totalPrice,
        discount: discount,
        tax: tax,
        total: totalWithTax,
        status: "confirmed",
        coupon_code: couponCode || null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    for (const item of orderItems) {
      db.insertInto("order_items")
        .values({
          order_id: order.id,
          product_id: item.productId,
          product_name: item.productName,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          item_total: item.itemTotal,
        })
        .execute();
    }

    logOrder(order.id, userId, totalWithTax);

    sendOrderConfirmationEmail(userId, order.id);

    res.status(201).json({
      orderId: order.id,
      items: orderItems,
      subtotal: totalPrice,
      discount: discount,
      tax: tax,
      total: totalWithTax,
      status: "confirmed",
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// ── Error Handler ───────────────────────────────────────────────────────────

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.log(err.stack);
  res.status(500).send("Internal Server Error: " + err.message);
});

// ── Start Server ────────────────────────────────────────────────────────────

const PORT = 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
