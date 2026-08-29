// Utilitários de cor: HSL, contraste WCAG e derivação automática de tokens
// pra garantir que o lojista NUNCA escolha cores que deixem o texto invisível.

export type HSL = { h: number; s: number; l: number };

export const hexToHsl = (hex: string): HSL => {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m || m.length < 3) return { h: 222, s: 47, l: 11 };
  const [r, g, b] = m.map(x => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      case b: h = ((r - g) / d + 4); break;
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
};

export const hslString = (c: HSL) => `${c.h} ${c.s}% ${c.l}%`;

const srgbToLin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

export const luminance = (hex: string): number => {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m || m.length < 3) return 0;
  const [r, g, b] = m.map(x => parseInt(x, 16));
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
};

const hslLuminance = (c: HSL) => {
  // boa aproximação: L direto do HSL não é WCAG, mas serve como guia rápido
  return c.l / 100;
};

export const contrastRatio = (hex1: string, hex2: string): number => {
  const a = luminance(hex1), b = luminance(hex2);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
};

/** Decide se texto deve ser claro ou escuro com base no fundo */
export const idealForegroundHsl = (bgHex: string): HSL => {
  return luminance(bgHex) > 0.5
    ? { h: 220, s: 25, l: 12 }   // texto bem escuro pra fundo claro
    : { h: 0, s: 0, l: 98 };      // texto bem claro pra fundo escuro
};

export const adjustL = (c: HSL, delta: number): HSL => ({
  ...c, l: Math.max(0, Math.min(100, c.l + delta)),
});

/**
 * Dado a cor primária e o fundo escolhidos pelo lojista,
 * deriva TODOS os tokens necessários (foreground, card, muted, border, etc.)
 * garantindo contraste legível.
 */
export const deriveBrandTokens = (primaryHex: string, bgHex: string) => {
  const primary = hexToHsl(primaryHex);
  const bg = hexToHsl(bgHex);
  const isLightBg = bg.l > 50;
  const fg = idealForegroundHsl(bgHex);
  const primaryFg = idealForegroundHsl(primaryHex);

  // card / popover ligeiramente diferente do fundo
  const card = isLightBg ? adjustL(bg, -3) : adjustL(bg, +4);
  const muted = isLightBg ? adjustL(bg, -6) : adjustL(bg, +6);
  const mutedFg = isLightBg ? adjustL(fg, +35) : adjustL(fg, -35);
  const border = isLightBg ? adjustL(bg, -10) : adjustL(bg, +10);
  const accent = { ...primary, l: isLightBg ? Math.min(95, primary.l + 35) : Math.max(15, primary.l - 25), s: Math.max(30, primary.s - 20) };
  const accentFg = idealForegroundHsl(`#${''}`); // fallback
  const ring = primary;

  return {
    '--background': hslString(bg),
    '--foreground': hslString(fg),
    '--card': hslString(card),
    '--card-foreground': hslString(fg),
    '--popover': hslString(card),
    '--popover-foreground': hslString(fg),
    '--primary': hslString(primary),
    '--primary-foreground': hslString(primaryFg),
    '--secondary': hslString(muted),
    '--secondary-foreground': hslString(fg),
    '--muted': hslString(muted),
    '--muted-foreground': hslString(mutedFg),
    '--accent': hslString(accent),
    '--accent-foreground': hslString(idealForegroundHsl(primaryHex)),
    '--border': hslString(border),
    '--input': hslString(border),
    '--ring': hslString(ring),
  } as Record<string, string>;
};

export const applyBrandTokens = (root: HTMLElement, tokens: Record<string, string>) => {
  Object.entries(tokens).forEach(([k, v]) => root.style.setProperty(k, v));
};

export const clearBrandTokens = (root: HTMLElement, keys: string[]) => {
  keys.forEach(k => root.style.removeProperty(k));
};

/** Retorna nível de aviso pra contraste do par cor primária x fundo */
export const contrastWarning = (primaryHex: string, bgHex: string): { level: 'ok' | 'low' | 'critical'; ratio: number; message: string } => {
  const ratio = contrastRatio(primaryHex, bgHex);
  if (ratio >= 4.5) return { level: 'ok', ratio, message: 'Excelente contraste, leitura fácil.' };
  if (ratio >= 3) return { level: 'low', ratio, message: 'Contraste fraco. Botões e textos pequenos podem ficar difíceis de ler.' };
  return { level: 'critical', ratio, message: 'Contraste insuficiente! O conteúdo vai sumir no fundo. Sugerimos mudar o tom.' };
};
