// packages/commerce/src/index.ts
// Official Street Framework commerce module: @streetjs/commerce.
//
// A cohesive commerce domain: products, inventory (with a strict no-oversell
// guarantee), carts, coupons, orders, reviews, and a payment-gateway
// abstraction. All monetary amounts are integer minor units (e.g. cents) to
// avoid floating-point money bugs.
//
// State is held in-memory for a single instance; the service is the seam for a
// persistent adapter (the other @streetjs/* packages demonstrate the
// store-interface + Postgres pattern). Payment is delegated to a
// {@link PaymentGateway}; a deterministic {@link FakeGateway} ships for tests
// and offline development, and Stripe/PayPal adapters implement the same
// interface.

import { randomUUID } from 'node:crypto';

// ── Money & errors ──────────────────────────────────────────────────────────────

export type Cents = number;

/** Thrown when a checkout cannot reserve enough stock (no oversell). */
export class InsufficientStockError extends Error {
  constructor(public readonly productId: string, public readonly requested: number, public readonly available: number) {
    super(`Insufficient stock for "${productId}": requested ${requested}, available ${available}`);
    this.name = 'InsufficientStockError';
  }
}

/** Thrown when the payment gateway declines a charge. */
export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentError';
  }
}

// ── Entities ──────────────────────────────────────────────────────────────────

export interface Product {
  id: string;
  name: string;
  priceCents: Cents;
  currency: string;
  active: boolean;
}

export interface StockLevel {
  onHand: number;
  reserved: number;
  available: number; // onHand - reserved
}

export interface CartLine {
  product: Product;
  quantity: number;
  lineTotalCents: Cents;
}

export interface Cart {
  id: string;
  lines: CartLine[];
  subtotalCents: Cents;
  currency: string | null;
}

export type CouponKind = 'percent' | 'fixed';

export interface Coupon {
  code: string;
  kind: CouponKind;
  /** percent: 1–100; fixed: amount in cents. */
  value: number;
  active: boolean;
  minSubtotalCents: Cents;
}

export interface DiscountResult {
  discountCents: Cents;
  totalCents: Cents;
}

export type OrderStatus = 'paid' | 'cancelled';

export interface OrderLine {
  productId: string;
  quantity: number;
  unitPriceCents: Cents;
}

export interface Order {
  id: string;
  lines: OrderLine[];
  currency: string;
  subtotalCents: Cents;
  discountCents: Cents;
  totalCents: Cents;
  couponCode: string | null;
  paymentId: string;
  status: OrderStatus;
  createdAt: number;
}

export interface Review {
  id: string;
  productId: string;
  userId: string;
  rating: number; // 1–5
  text: string;
  createdAt: number;
}

// ── Payment gateway ─────────────────────────────────────────────────────────────

export interface ChargeRequest {
  amountCents: Cents;
  currency: string;
  /** Idempotency / correlation reference (e.g. order id). */
  reference: string;
}

export interface ChargeResult {
  id: string;
  status: 'succeeded';
}

/** A payment backend. Implementations throw {@link PaymentError} on decline. */
export interface PaymentGateway {
  readonly name: string;
  charge(request: ChargeRequest): Promise<ChargeResult>;
  refund(paymentId: string): Promise<void>;
}

export interface FakeGatewayOptions {
  /** Decline charges whose amount is >= this threshold (to test failures). */
  declineAtOrAbove?: Cents;
  idGen?: () => string;
}

/** Deterministic, network-free gateway for tests and offline development. */
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
  /** Default payment gateway. Defaults to a {@link FakeGateway}. */
  gateway?: PaymentGateway;
  /** Default currency for new products. Default 'USD'. */
  defaultCurrency?: string;
  now?: () => number;
  idGen?: () => string;
}

/**
 * The commerce domain service. The headline guarantee is **no oversell**:
 * `checkout` reserves stock all-or-nothing and never lets availability go
 * negative, even across many interleaved checkouts.
 */
export class CommerceService {
  private readonly products = new Map<string, Product>();
  private readonly stock = new Map<string, { onHand: number; reserved: number }>();
  private readonly carts = new Map<string, Map<string, number>>();
  private readonly coupons = new Map<string, Coupon>();
  private readonly orders = new Map<string, Order>();
  /** productId -> (userId -> Review) */
  private readonly reviews = new Map<string, Map<string, Review>>();

  private readonly gateway: PaymentGateway;
  private readonly defaultCurrency: string;
  private readonly now: () => number;
  private readonly idGen: () => string;

  constructor(options: CommerceServiceOptions = {}) {
    this.gateway = options.gateway ?? new FakeGateway();
    this.defaultCurrency = options.defaultCurrency ?? 'USD';
    this.now = options.now ?? (() => Date.now());
    this.idGen = options.idGen ?? (() => randomUUID());
  }

  // ── Products ─────────────────────────────────────────────────────────────────

  createProduct(input: { name: string; priceCents: Cents; currency?: string; id?: string }): Product {
    const name = requireNonEmpty(input?.name, 'name');
    const priceCents = requireMoney(input?.priceCents, 'priceCents');
    const product: Product = {
      id: input.id ?? this.idGen(),
      name,
      priceCents,
      currency: input.currency ?? this.defaultCurrency,
      active: true,
    };
    this.products.set(product.id, product);
    this.stock.set(product.id, { onHand: 0, reserved: 0 });
    return { ...product };
  }

  getProduct(id: string): Product | undefined {
    const p = this.products.get(requireNonEmpty(id, 'id'));
    return p ? { ...p } : undefined;
  }

  listProducts(options: { activeOnly?: boolean } = {}): Product[] {
    const all = [...this.products.values()];
    return (options.activeOnly ? all.filter((p) => p.active) : all).map((p) => ({ ...p }));
  }

  setPrice(id: string, priceCents: Cents): Product {
    const p = this.requireProduct(id);
    p.priceCents = requireMoney(priceCents, 'priceCents');
    return { ...p };
  }

  deactivateProduct(id: string): Product {
    const p = this.requireProduct(id);
    p.active = false;
    return { ...p };
  }

  // ── Inventory ────────────────────────────────────────────────────────────────

  restock(productId: string, quantity: number): StockLevel {
    this.requireProduct(productId);
    const qty = requireCount(quantity, 'quantity');
    const s = this.stock.get(productId)!;
    s.onHand += qty;
    return this.availability(productId);
  }

  availability(productId: string): StockLevel {
    this.requireProduct(productId);
    const s = this.stock.get(productId)!;
    return { onHand: s.onHand, reserved: s.reserved, available: s.onHand - s.reserved };
  }

  // ── Cart ─────────────────────────────────────────────────────────────────────

  addToCart(cartId: string, productId: string, quantity: number): Cart {
    const id = requireNonEmpty(cartId, 'cartId');
    const product = this.requireProduct(productId);
    if (!product.active) throw new Error(`Product "${productId}" is not purchasable (inactive)`);
    const qty = requireCount(quantity, 'quantity');
    const cart = this.getOrCreateCart(id);
    this.assertCurrencyMatch(cart, product);
    cart.set(productId, (cart.get(productId) ?? 0) + qty);
    return this.getCart(id);
  }

  setQuantity(cartId: string, productId: string, quantity: number): Cart {
    const id = requireNonEmpty(cartId, 'cartId');
    this.requireProduct(productId);
    const cart = this.getOrCreateCart(id);
    if (quantity <= 0) {
      cart.delete(productId);
    } else {
      cart.set(productId, Math.floor(quantity));
    }
    return this.getCart(id);
  }

  removeFromCart(cartId: string, productId: string): Cart {
    const id = requireNonEmpty(cartId, 'cartId');
    this.getOrCreateCart(id).delete(productId);
    return this.getCart(id);
  }

  clearCart(cartId: string): void {
    this.carts.delete(requireNonEmpty(cartId, 'cartId'));
  }

  getCart(cartId: string): Cart {
    const id = requireNonEmpty(cartId, 'cartId');
    const cart = this.carts.get(id) ?? new Map<string, number>();
    const lines: CartLine[] = [];
    let subtotalCents = 0;
    let currency: string | null = null;
    for (const [productId, quantity] of cart) {
      const product = this.products.get(productId);
      if (!product) continue;
      currency = product.currency;
      const lineTotalCents = product.priceCents * quantity;
      subtotalCents += lineTotalCents;
      lines.push({ product: { ...product }, quantity, lineTotalCents });
    }
    lines.sort((a, b) => (a.product.id < b.product.id ? -1 : a.product.id > b.product.id ? 1 : 0));
    return { id, lines, subtotalCents, currency };
  }

  // ── Coupons ──────────────────────────────────────────────────────────────────

  createCoupon(input: { code: string; kind: CouponKind; value: number; minSubtotalCents?: Cents }): Coupon {
    const code = requireNonEmpty(input?.code, 'code').toUpperCase();
    if (input.kind !== 'percent' && input.kind !== 'fixed') {
      throw new Error('createCoupon: kind must be "percent" or "fixed"');
    }
    if (input.kind === 'percent' && (input.value <= 0 || input.value > 100)) {
      throw new Error('createCoupon: percent value must be in (0, 100]');
    }
    if (input.kind === 'fixed') requireMoney(input.value, 'value');
    const coupon: Coupon = {
      code,
      kind: input.kind,
      value: input.value,
      active: true,
      minSubtotalCents: input.minSubtotalCents ?? 0,
    };
    this.coupons.set(code, coupon);
    return { ...coupon };
  }

  /** Compute the discount + total for a subtotal under `code`. Throws if invalid. */
  applyCoupon(subtotalCents: Cents, code: string): DiscountResult {
    requireMoney(subtotalCents, 'subtotalCents');
    const coupon = this.coupons.get(requireNonEmpty(code, 'code').toUpperCase());
    if (!coupon || !coupon.active) throw new Error(`Coupon "${code}" is not valid`);
    if (subtotalCents < coupon.minSubtotalCents) {
      throw new Error(`Coupon "${code}" requires a subtotal of at least ${coupon.minSubtotalCents}`);
    }
    const discountCents =
      coupon.kind === 'percent'
        ? Math.floor((subtotalCents * coupon.value) / 100)
        : Math.min(coupon.value, subtotalCents);
    return { discountCents, totalCents: subtotalCents - discountCents };
  }

  // ── Checkout / Orders ──────────────────────────────────────────────────────────

  /**
   * Convert a cart into a paid order. Reserves stock all-or-nothing (no
   * oversell), applies an optional coupon, charges via the gateway, then commits
   * stock and clears the cart. If payment fails, the reservation is released and
   * a {@link PaymentError} is thrown. If stock is insufficient,
   * {@link InsufficientStockError} is thrown before any charge.
   */
  async checkout(
    cartId: string,
    options: { couponCode?: string; gateway?: PaymentGateway } = {},
  ): Promise<Order> {
    const cart = this.getCart(cartId);
    if (cart.lines.length === 0) throw new Error('checkout: cart is empty');
    const currency = cart.currency!;

    // 1. Reserve stock atomically (synchronous: no await between check & mutate).
    this.reserveAll(cart);

    try {
      // 2. Pricing.
      const subtotalCents = cart.subtotalCents;
      let discountCents = 0;
      let couponCode: string | null = null;
      if (options.couponCode) {
        const applied = this.applyCoupon(subtotalCents, options.couponCode);
        discountCents = applied.discountCents;
        couponCode = options.couponCode.toUpperCase();
      }
      const totalCents = subtotalCents - discountCents;

      // 3. Charge.
      const orderId = this.idGen();
      const gateway = options.gateway ?? this.gateway;
      const payment = await gateway.charge({ amountCents: totalCents, currency, reference: orderId });

      // 4. Commit stock (move reserved -> consumed) and finalize.
      this.commitAll(cart);
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
      this.orders.set(order.id, order);
      this.clearCart(cartId);
      return { ...order, lines: order.lines.map((l) => ({ ...l })) };
    } catch (err) {
      // Release the reservation on any failure after reserving.
      this.releaseAll(cart);
      throw err;
    }
  }

  getOrder(id: string): Order | undefined {
    const o = this.orders.get(requireNonEmpty(id, 'id'));
    return o ? { ...o, lines: o.lines.map((l) => ({ ...l })) } : undefined;
  }

  listOrders(): Order[] {
    return [...this.orders.values()].map((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l })) }));
  }

  /** Cancel a paid order: refund and restock. Idempotent for already-cancelled. */
  async cancelOrder(id: string, gateway?: PaymentGateway): Promise<Order> {
    const order = this.orders.get(requireNonEmpty(id, 'id'));
    if (!order) throw new Error(`Order "${id}" not found`);
    if (order.status === 'cancelled') return { ...order, lines: order.lines.map((l) => ({ ...l })) };
    await (gateway ?? this.gateway).refund(order.paymentId);
    for (const line of order.lines) {
      const s = this.stock.get(line.productId);
      if (s) s.onHand += line.quantity; // return stock to shelf
    }
    order.status = 'cancelled';
    return { ...order, lines: order.lines.map((l) => ({ ...l })) };
  }

  // ── Reviews ──────────────────────────────────────────────────────────────────

  addReview(input: { productId: string; userId: string; rating: number; text?: string }): Review {
    this.requireProduct(input?.productId);
    const userId = requireNonEmpty(input?.userId, 'userId');
    const rating = input?.rating;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error('addReview: rating must be an integer in [1, 5]');
    }
    let byUser = this.reviews.get(input.productId);
    if (!byUser) {
      byUser = new Map<string, Review>();
      this.reviews.set(input.productId, byUser);
    }
    const existing = byUser.get(userId);
    const review: Review = {
      id: existing?.id ?? this.idGen(),
      productId: input.productId,
      userId,
      rating,
      text: input.text ?? '',
      createdAt: existing?.createdAt ?? this.now(),
    };
    byUser.set(userId, review); // upsert: one review per (user, product)
    return { ...review };
  }

  listReviews(productId: string): Review[] {
    this.requireProduct(productId);
    return [...(this.reviews.get(productId)?.values() ?? [])].map((r) => ({ ...r }));
  }

  averageRating(productId: string): number {
    const all = this.listReviews(productId);
    if (all.length === 0) return 0;
    return all.reduce((sum, r) => sum + r.rating, 0) / all.length;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private reserveAll(cart: Cart): void {
    // First pass: verify every line can be satisfied (no partial reservation).
    for (const line of cart.lines) {
      const s = this.stock.get(line.product.id)!;
      const available = s.onHand - s.reserved;
      if (available < line.quantity) {
        throw new InsufficientStockError(line.product.id, line.quantity, available);
      }
    }
    // Second pass: reserve (synchronous, so no interleaving can occur).
    for (const line of cart.lines) {
      this.stock.get(line.product.id)!.reserved += line.quantity;
    }
  }

  private commitAll(cart: Cart): void {
    for (const line of cart.lines) {
      const s = this.stock.get(line.product.id)!;
      s.reserved -= line.quantity;
      s.onHand -= line.quantity;
    }
  }

  private releaseAll(cart: Cart): void {
    for (const line of cart.lines) {
      const s = this.stock.get(line.product.id);
      if (s) s.reserved = Math.max(0, s.reserved - line.quantity);
    }
  }

  private requireProduct(id: string): Product {
    const p = this.products.get(requireNonEmpty(id, 'productId'));
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

  private assertCurrencyMatch(cart: Map<string, number>, product: Product): void {
    for (const productId of cart.keys()) {
      const existing = this.products.get(productId);
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

export * from './gateways.js';
