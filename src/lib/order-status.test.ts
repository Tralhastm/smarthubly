import { describe, expect, it } from 'vitest';
import { CANCELLED_ORDER_STATUS, isTestOrder, isVisibleOrder, PENDING_PAYMENT_STATUS } from './order-status';

describe('test-order visibility', () => {
  it('recognizes only the explicit persisted test marker', () => {
    expect(isTestOrder({ metadata: { is_test_order: true } })).toBe(true);
    expect(isTestOrder({ metadata: { is_test_order: 'true' } })).toBe(true);
    expect(isTestOrder({ metadata: { demo_payment: 'true' } })).toBe(false);
    expect(isTestOrder({ metadata: { test_stock_override_payment: true } })).toBe(false);
    expect(isTestOrder({ metadata: { is_test_order: false } })).toBe(false);
  });

  it('hides test orders by default and exposes them only with explicit inclusion', () => {
    const testOrder = { status: 'cancelled', metadata: { is_test_order: true } };
    expect(isVisibleOrder(testOrder)).toBe(false);
    expect(isVisibleOrder(testOrder, true)).toBe(true);
  });

  it('preserves the existing visibility rules for non-test orders', () => {
    expect(isVisibleOrder({ status: 'delivered' })).toBe(true);
    expect(isVisibleOrder({ status: CANCELLED_ORDER_STATUS })).toBe(false);
    expect(isVisibleOrder({ status: PENDING_PAYMENT_STATUS })).toBe(false);
  });
});
