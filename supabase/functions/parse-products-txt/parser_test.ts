import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { parseCatalog } from "./index.ts";

Deno.test("parser preserva Sage como identidade própria e não inventa Verde", () => {
  const [product] = parseCatalog("iPhone 17 256GB (R$ 5.350) sage");
  assert(product);
  assertEquals(product.variants.map((item) => item.name), ["Sage"]);
  assertEquals(product.variants[0].available, true);
  assertEquals(product.variants[0].cost_price, 5350);
});

Deno.test("parser reconhece cores em português e inglês sem duplicar aliases equivalentes", () => {
  const [product] = parseCatalog("Galaxy A57 (R$ 1.500) black, azul, green");
  assert(product);
  assertEquals(product.variants.map((item) => item.name), ["Preto", "Azul", "Verde"]);
});

Deno.test("parser marca a cor explicitamente sinalizada como indisponível", () => {
  const [product] = parseCatalog("Poco X8 (R$ 2.000) azul\nverificar disponibilidade\n🔵");
  assert(product);
  assertEquals(product.variants.length, 1);
  assertEquals(product.variants[0].name, "Azul");
  assertEquals(product.variants[0].available, false);
});

Deno.test("parser não transforma linha de instrução em cor ou produto", () => {
  const products = parseCatalog("Samsung\nconferir disponibilidade\nGalaxy A07 128GB (R$ 750) preto");
  assertEquals(products.length, 1);
  assertEquals(products[0].name, "Galaxy A07 128GB");
  assertEquals(products[0].variants[0].name, "preto");
});

Deno.test("parser interpreta custo brasileiro com milhar e decimal", () => {
  const [product] = parseCatalog("Redmi Note 14 (R$ 1.999,90) white");
  assert(product);
  assertEquals(product.cost_price, 1999.9);
});
