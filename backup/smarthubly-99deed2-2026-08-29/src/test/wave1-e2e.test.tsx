// E2E-style integration tests da Onda 1 (Caixa, Split, KDS).
// Como o projeto não tem Playwright, usamos vitest + RTL + supabase mockado
// para simular os fluxos completos end-to-end.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ===== Mock global do supabase =====
type Row = Record<string, any>;
const db: { sessions: Row[]; movements: Row[]; orders: Row[] } = {
  sessions: [],
  movements: [],
  orders: [],
};

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: keyof typeof db) => {
    let rows = [...db[table]];
    const ctx: any = {
      _filters: [] as Array<(r: Row) => boolean>,
      select() { return ctx; },
      eq(col: string, val: any) { ctx._filters.push((r) => r[col] === val); return ctx; },
      neq(col: string, val: any) { ctx._filters.push((r) => r[col] !== val); return ctx; },
      in(col: string, vals: any[]) { ctx._filters.push((r) => vals.includes(r[col])); return ctx; },
      order() { return ctx; },
      limit(n: number) { rows = rows.slice(0, n); return ctx; },
      _apply() { return rows.filter((r) => ctx._filters.every((f: any) => f(r))); },
      maybeSingle() { return Promise.resolve({ data: ctx._apply()[0] ?? null, error: null }); },
      single() { return Promise.resolve({ data: ctx._apply()[0] ?? null, error: null }); },
      then(res: any) { return Promise.resolve({ data: ctx._apply(), error: null }).then(res); },
      insert(payload: any) {
        const arr = Array.isArray(payload) ? payload : [payload];
        const inserted = arr.map((p) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), status: "open", ...p }));
        db[table].push(...inserted);
        const chain: any = {
          select: () => ({ single: () => Promise.resolve({ data: inserted[0], error: null }) }),
          then: (r: any) => Promise.resolve({ data: inserted, error: null }).then(r),
        };
        return chain;
      },
      update(patch: any) {
        const updChain: any = {
          eq(col: string, val: any) {
            db[table].forEach((r) => { if (r[col] === val) Object.assign(r, patch); });
            return Promise.resolve({ data: null, error: null });
          },
        };
        return updChain;
      },
    };
    return ctx;
  };
  return {
    supabase: {
      from: (t: string) => {
        const map: any = { cash_register_sessions: "sessions", cash_movements: "movements", orders: "orders", order_items: "orders" };
        return builder(map[t] ?? "orders");
      },
      rpc: (fn: string, args: any) => {
        if (fn === "calc_cash_session_expected") {
          const s = db.sessions.find((x) => x.id === args._session_id);
          if (!s) return Promise.resolve({ data: 0, error: null });
          const movs = db.movements.filter((m) => m.session_id === args._session_id);
          const sup = movs.filter((m) => m.type === "suprimento").reduce((a, m) => a + Number(m.amount), 0);
          const san = movs.filter((m) => m.type === "sangria").reduce((a, m) => a + Number(m.amount), 0);
          return Promise.resolve({ data: Number(s.opening_amount) + sup - san, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      channel: () => ({ on: function () { return this; }, subscribe: () => ({}) }),
      removeChannel: () => {},
    },
  };
});

import { useOpenCash, useCloseCash, useAddCashMovement, useOpenCashSession, useSessionExpected } from "@/hooks/useCashRegister";
import PdvPayment from "@/components/pdv/PdvPayment";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: any) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => { db.sessions = []; db.movements = []; db.orders = []; });

describe("E2E Onda 1 — Caixa", () => {
  it("fluxo completo: abrir → suprimento → sangria → fechar com diferença correta", async () => {
    const Wrapper = wrap();
    const { result: openR } = await import("@testing-library/react").then((m) => m.renderHook(() => useOpenCash(), { wrapper: Wrapper }));
    await act(async () => {
      await openR.current.mutateAsync({ tenantId: "t1", operatorName: "Alice", openingAmount: 100 });
    });
    expect(db.sessions).toHaveLength(1);
    const sid = db.sessions[0].id;

    const { result: movR } = await import("@testing-library/react").then((m) => m.renderHook(() => useAddCashMovement(), { wrapper: Wrapper }));
    await act(async () => {
      await movR.current.mutateAsync({ sessionId: sid, tenantId: "t1", type: "suprimento", amount: 50, operatorName: "Alice" });
      await movR.current.mutateAsync({ sessionId: sid, tenantId: "t1", type: "sangria", amount: 30, operatorName: "Alice" });
    });
    expect(db.movements).toHaveLength(2);

    const { result: closeR } = await import("@testing-library/react").then((m) => m.renderHook(() => useCloseCash(), { wrapper: Wrapper }));
    let res: any;
    await act(async () => {
      res = await closeR.current.mutateAsync({ sessionId: sid, closingAmount: 125, closedBy: "Alice" });
    });
    // esperado = 100 + 50 - 30 = 120; diferença = 125 - 120 = 5 (sobra)
    expect(res.expected).toBe(120);
    expect(res.difference).toBe(5);
    expect(db.sessions[0].status).toBe("closed");
  });

  it("expected reflete suprimentos e sangrias via RPC", async () => {
    const Wrapper = wrap();
    db.sessions.push({ id: "s1", tenant_id: "t1", opening_amount: 200, status: "open" });
    db.movements.push({ session_id: "s1", type: "suprimento", amount: 40 });
    db.movements.push({ session_id: "s1", type: "sangria", amount: 25 });

    const { result } = await import("@testing-library/react").then((m) => m.renderHook(() => useSessionExpected("s1"), { wrapper: Wrapper }));
    await waitFor(() => expect(result.current.data).toBe(215));
  });

  it("não retorna sessão aberta quando não existe", async () => {
    const Wrapper = wrap();
    const { result } = await import("@testing-library/react").then((m) => m.renderHook(() => useOpenCashSession("t1"), { wrapper: Wrapper }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe("E2E Onda 1 — Split de pagamento", () => {
  it("permite pagar com 1 método (sem split)", async () => {
    const onPay = vi.fn();
    render(<PdvPayment total={50} onBack={() => {}} onPay={onPay} />);
    fireEvent.click(screen.getByText("PIX"));
    expect(onPay).toHaveBeenCalledWith("pix");
  });

  it("split: divide 100 em 60 dinheiro + 40 pix e finaliza", async () => {
    const onPay = vi.fn();
    render(<PdvPayment total={100} onBack={() => {}} onPay={onPay} />);
    fireEvent.click(screen.getByRole("button", { name: /split/i }));

    // Adiciona dinheiro 60
    fireEvent.click(screen.getByRole("button", { name: "Dinheiro" }));
    fireEvent.change(screen.getByPlaceholderText(/Até/), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    // Resto 40 em PIX
    fireEvent.click(screen.getByRole("button", { name: "PIX" }));
    fireEvent.click(screen.getByRole("button", { name: "Resto" }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    fireEvent.click(screen.getByRole("button", { name: /finalizar venda/i }));
    expect(onPay).toHaveBeenCalledTimes(1);
    const [, split] = onPay.mock.calls[0];
    expect(split).toHaveLength(2);
    expect(split[0]).toEqual({ method: "dinheiro", amount: 60 });
    expect(split[1]).toEqual({ method: "pix", amount: 40 });
  });

  it("split: não permite finalizar se faltar pagar", () => {
    const onPay = vi.fn();
    render(<PdvPayment total={100} onBack={() => {}} onPay={onPay} />);
    fireEvent.click(screen.getByRole("button", { name: /split/i }));
    fireEvent.change(screen.getByPlaceholderText(/Até/), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    const btn = screen.getByRole("button", { name: /finalizar venda/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(onPay).not.toHaveBeenCalled();
  });
});
