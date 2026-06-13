// packages/commerce/src/index.ts
// Official Street Framework commerce module: @streetjs/commerce.
//
// Products, inventory (no oversell), carts, coupons, orders, reviews, and a
// payment-gateway abstraction. State lives behind a pluggable async
// {@link CommerceStore} (in-memory default or Postgres). The no-oversell
// guarantee is enforced by the store's atomic `reserveStock`.
//
// Carts are kept in-process (transient, per-session); persistent stores back
// products/stock/coupons/orders/reviews. The oversell guarantee does not depend
// on cart storage — it depends on the atomic reservation in the store.

import { randomUUID } from 'node:crypto';

import {
  type Cents, type Product, type StockLevel, type Cart, type CartLine, type CouponKind,
  type Coupon, type DiscountResult, type Order, type Review,
  type PaymentGateway, type ChargeRequest, type ChargeResult,
  InsufficientStockError, PaymentError,
} from './types.js';
import { InMemoryCommerceStore, type CommerceStore } from './store.js';

export * from './types.js';
export * from './store.js';
export * from './pg.js';
export * from './gateways.js';

// ── Fake gateway (offline default) ───────────────────────────────────────────────

export interface FakeGatewayOptions {
  declineAtOrAbove?: Cents;
  idGen?: () => string;
}

export class FakeGateway implements PaymentGateway {
  readonly name = 'fake';
  private readonly declineAtOrAbove: number;
  private readonly idGen: () => string;
  readonly charged: ChargeRequest[] = [];
  readonly refunded: string[] = [];

  constructor(options: FakeGatewayOptions = {}) {
    this.declineAtOrAbove = options.declineAtOrAbove ?? Number.POSITIVE_INFINITY;
    this.idGen = options.idGen ?? (() => `pay_${randomUUID()}`);
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    if (request.amountCents >= this.declineAtOrAbove) {
      throw new PaymentError(`card declined for amount ${request.amountCents}`);
    }
    this.charged.push(request);
    return { id: this.idGen(), status: 'succeeded' };
  }

  async refund(paymentId: string): Promise<void> {
    this.refunded.push(paymentId);
  }
}

// ── Service ─────────────────────────────────────────────────────────────────────

export interface CommerceServiceOptions {
  store?: CommerceStore;
  gateway?: PaymentGateway;
  defaultCurrency?: string;
  now?: () => number;
  idGen?: () => string;
}

export class CommerceService {
  private readonly store: CommerceStore;
  private readonly gateway: PaymentGateway;
  private readonly defaultCurrency: string;
  private readonly now: () => number;
  private readonly idGen: () => string;
  /** Transient, in-process carts: cartId -> (productId -> qty). */
  private readonly carts = new Map<string, Map<string, number>>();

  constructor(options: CommerceServiceOptions = {}) {
    this.store = options.store ?? new InMemoryCommerceStore();
    this.gateway = options.gateway ?? new FakeGateway();
    this.defaultCurrency = options.defaultCurrency ?? 'USD';
    this.now = options.now ?? (() => Date.now());
    this.idGen = options.idGen ?? (() => randomUUID());
  }

  // ── Products ─────────────────────────────────────────────────────────────────

  async createProduct(input: { name: string; priceCents: Cents; currency?: string; id?: string }): Promise<Product> {
    const product: Product = {
      id: input.id ?? this.idGen(),
      name: requireNonEmpty(input?.name, 'name'),
      priceCents: requireMoney(input?.priceCents, 'priceCents'),
      currency: input.currency ?? this.defaultCurrency,
      active: true,
    };
    await this.store.insertProduct(product);
    await this.store.initStock(product.id);
    return product;
  }

  async getProduct(id: string): Promise<Product | undefined> {
    return this.store.getProduct(requireNonEmpty(id, 'id'));
  }

  async listProducts(options: { activeOnly?: boolean } = {}): Promise<Product[]> {
    const all = await this.store.listProducts();
    return options.activeOnly ? all.filter((p) => p.active) : all;
  }

  async setPrice(id: string, priceCents: Cents): Promise<Product> {
    const p = await this.requireProduct(id);
    p.priceCents = requireMoney(priceCents, 'priceCents');
    await this.store.updateProduct(p);
    return p;
  }

  async deactivateProduct(id: string): Promise<Product> {
    const p = await this.requireProduct(id);
    p.active = false;
    await this.store.updateProduct(p);
    return p;
  }

  // ── Inventory ────────────────────────────────────────────────────────────────

  async restock(productId: string, quantity: number): Promise<StockLevel> {
    await this.requireProduct(productId);
    await this.store.restock(productId, requireCount(quantity, 'quantity'));
    return this.store.getStock(productId);
  }

  async availability(productId: string): Promise<StockLevel> {
    await this.requireProduct(productId);
    return this.store.getStock(productId);
  }

  // ── Cart ─────────────────────────────────────────────────────────────────────

  async addToCart(cartId: string, productId: string, quantity: number): Promise<Cart> {
    const id = requireNonEmpty(cartId, 'cartId');
    const product = await this.requireProduct(productId);
    if (!product.active) throw new Error(`Product "${productId}" is not purchasable (inactive)`);
    const qty = requireCount(quantity, 'quantity');
    const cart = this.getOrCreateCart(id);
    await this.assertCurrencyMatch(cart, product);
    cart.set(productId, (cart.get(productId) ?? 0) + qty);
    return this.getCart(id);
  }

  async setQuantity(cartId: string, productId: string, quantity: number): Promise<Cart> {
    const id = requireNonEmpty(cartId, 'cartId');
    await this.requireProduct(productId);
    const cart = this.getOrCreateCart(id);
    if (quantity <= 0) cart.delete(productId);
    else cart.set(productId, Math.floor(quantity));
    return this.getCart(id);
  }

  async removeFromCart(cartId: string, productId: string): Promise<Cart> {
    const id = requireNonEmpty(cartId, 'cartId');
    this.getOrCreateCart(id).delete(productId);
    return this.getCart(id);
  }

  clearCart(cartId: string): void {
    this.carts.delete(requireNonEmpty(cartId, 'cartId'));
  }

  async getCart(cartId: string): Promise<Cart> {
    const id = requireNonEmpty(cartId, 'cartId');
    const cart = this.carts.get(id) ?? new Map<string, number>();
    const lines: CartLine[] = [];
    let subtotalCents = 0;
    let currency: string | null = null;
    for (const [productId, quantity] of cart) {
      const product = await this.store.getProduct(productId);
      if (!product) continue;
      currency = product.currency;
      const lineTotalCents = product.priceCents * quantity;
      subtotalCents += lineTotalCents;
      lines.push({ product, quantity, lineTotalCents });
    }
    lines.sort((a, b) => (a.product.id < b.product.id ? -1 : a.product.id > b.product.id ? 1 : 0));
    return { id, lines, subtotalCents, currency };
  }

  // ── Coupons ──────────────────────────────────────────────────────────────────

  async createCoupon(input: { code: string; kind: CouponKind; value: number; minSubtotalCents?: Cents }): Promise<Coupon> {
    const code = requireNonEmpty(input?.code, 'code').toUpperCase();
    if (input.kind !== 'percent' && input.kind !== 'fixed') {
      throw new Error('createCoupon: kind must be "percent" or "fixed"');
    }
    if (input.kind === 'percent' && (input.value <= 0 || input.value > 100)) {
      throw new Error('createCoupon: percent value must be in (0, 100]');
    }
    if (input.kind === 'fixed') requireMoney(input.value, 'value');
    const coupon: Coupon = { code, kind: input.kind, value: input.value, active: true, minSubtotalCents: input.minSubtotalCents ?? 0 };
    await this.store.insertCoupon(coupon);
    return coupon;
  }

  async applyCoupon(subtotalCents: Cents, code: string): Promise<DiscountResult> {
    requireMoney(subtotalCents, 'subtotalCents');
    const coupon = await this.store.getCoupon(requireNonEmpty(code, 'code').toUpperCase());
    if (!coupon || !coupon.active) throw new Error(`Coupon "${code}" is not valid`);
    if (subtotalCents < coupon.minSubtotalCents) {
      throw new Error(`Coupon "${code}" requires a subtotal of at least ${coupon.minSubtotalCents}`);
    }
    const discountCents =
      coupon.kind === 'percent' ? Math.floor((subtotalCents * coupon.value) / 100) : Math.min(coupon.value, subtotalCents);
    return { discountCents, totalCents: subtotalCents - discountCents };
  }

  // ── Checkout / Orders ──────────────────────────────────────────────────────────

  async checkout(cartId: string, options: { couponCode?: string; gateway?: PaymentGateway } = {}): Promise<Order> {
    const cart = await this.getCart(cartId);
    if (cart.lines.length === 0) throw new Error('checkout: cart is empty');
    const currency = cart.currency!;

    // 1. Reserve each line atomically; compensate (release) on partial failure.
    const reserved: { productId: string; quantity: number }[] = [];
    for (const line of cart.lines) {
      const ok = await this.store.reserveStock(line.product.id, line.quantity);
      if (!ok) {
        for (const r of reserved) await this.store.releaseStock(r.productId, r.quantity);
        const avail = await this.store.getStock(line.product.id);
        throw new InsufficientStockError(line.product.id, line.quantity, avail.available);
      }
      reserved.push({ productId: line.product.id, quantity: line.quantity });
    }

    try {
      const subtotalCents = cart.subtotalCents;
      let discountCents = 0;
      let couponCode: string | null = null;
      if (options.couponCode) {
        const applied = await this.applyCoupon(subtotalCents, options.couponCode);
        discountCents = applied.discountCents;
        couponCode = options.couponCode.toUpperCase();
      }
      const totalCents = subtotalCents - discountCents;

      const orderId = this.idGen();
      const gateway = options.gateway ?? this.gateway;
      const payment = await gateway.charge({ amountCents: totalCents, currency, reference: orderId });

      for (const r of reserved) await this.store.commitStock(r.productId, r.quantity);

      const order: Order = {
        id: orderId,
        lines: cart.lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, unitPriceCents: l.product.priceCents })),
        currency,
        subtotalCents,
        discountCents,
        totalCents,
        couponCode,
        paymentId: payment.id,
        status: 'paid',
        createdAt: this.now(),
      };
      await this.store.insertOrder(order);
      this.clearCart(cartId);
      return order;
    } catch (err) {
      for (const r of reserved) await this.store.releaseStock(r.productId, r.quantity);
      throw err;
    }
  }

  async getOrder(id: string): Promise<Order | undefined> {
    return this.store.getOrder(requireNonEmpty(id, 'id'));
  }

  async listOrders(): Promise<Order[]> {
    return this.store.listOrders();
  }

  async cancelOrder(id: string, gateway?: PaymentGateway): Promise<Order> {
    const order = await this.store.getOrder(requireNonEmpty(id, 'id'));
    if (!order) throw new Error(`Order "${id}" not found`);
    if (order.status === 'cancelled') return order;
    await (gateway ?? this.gateway).refund(order.paymentId);
    for (const line of order.lines) await this.store.restock(line.productId, line.quantity);
    order.status = 'cancelled';
    await this.store.updateOrder(order);
    return order;
  }

  // ── Reviews ──────────────────────────────────────────────────────────────────

  async addReview(input: { productId: string; userId: string; rating: number; text?: string }): Promise<Review> {
    await this.requireProduct(input?.productId);
    const userId = requireNonEmpty(input?.userId, 'userId');
    const rating = input?.rating;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error('addReview: rating must be an integer in [1, 5]');
    }
    const existing = await this.store.getReview(input.productId, userId);
    const review: Review = {
      id: existing?.id ?? this.idGen(),
      productId: input.productId,
      userId,
      rating,
      text: input.text ?? '',
      createdAt: existing?.createdAt ?? this.now(),
    };
    await this.store.upsertReview(review);
    return review;
  }

  async listReviews(productId: string): Promise<Review[]> {
    await this.requireProduct(productId);
    return this.store.listReviews(productId);
  }

  async averageRating(productId: string): Promise<number> {
    const all = await this.listReviews(productId);
    if (all.length === 0) return 0;
    return all.reduce((sum, r) => sum + r.rating, 0) / all.length;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async requireProduct(id: string): Promise<Product> {
    const p = await this.store.getProduct(requireNonEmpty(id, 'productId'));
    if (!p) throw new Error(`Product "${id}" not found`);
    return p;
  }

  private getOrCreateCart(cartId: string): Map<string, number> {
    let cart = this.carts.get(cartId);
    if (!cart) {
      cart = new Map<string, number>();
      this.carts.set(cartId, cart);
    }
    return cart;
  }

  private async assertCurrencyMatch(cart: Map<string, number>, product: Product): Promise<void> {
    for (const productId of cart.keys()) {
      const existing = await this.store.getProduct(productId);
      if (existing && existing.currency !== product.currency) {
        throw new Error(`Cart currency mismatch: ${existing.currency} vs ${product.currency}`);
      }
    }
  }
}

// ── validation helpers ──────────────────────────────────────────────────────────

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`CommerceService: ${field} must be a non-empty string`);
  }
  return value;
}

function requireMoney(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`CommerceService: ${field} must be a non-negative integer (minor units)`);
  }
  return value;
}

function requireCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`CommerceService: ${field} must be a positive integer`);
  }
  return value;
}
