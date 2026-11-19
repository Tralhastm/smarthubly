import { describe, expect, it } from 'vitest';
import { parseSupplierPriceList } from './supplier-price-list-parser';

describe('parseSupplierPriceList', () => {
  it('lê a lista Apple com preço na linha do modelo e cores na linha seguinte', () => {
    const source = `🍏REPOSIÇÃO APPLE🍏

*15 128gb….R$4.050*
Azul 🩵

*15 128gb…R$4.050*
Preto🖤

*16 128gb…R$4.750*
Preto branco ⚪️🖤

*17E 256gb…R$4.250*
Rosa 🌹

*17 256gb…R$5.700*
Branco verde 💚⚪️

*17 256gb…R$5.700*
Preto 🖤

*17 256gb…R$5.700*
Azul e roxo 🩵💜

*17 pro 256gb…R$7.400*
Laranja 🍊

*17 pro max 256gb…8.100*
Silver ⚪️

*17 pro max 256gb…R$7.750*
Azul 💙

*17 pro max 256gb…R$7.700*
Laranja 🍊

*18 pro 256gb…R$8.250*
Bordô 🍁

*18 pro 256gb…R$.8.250*
Azul🩵

*18 pro 256gb…R$8.250*
Silver ⚪️

*18 pro Max 256gb…R$9.150*
silver

*18 pro Max 256gb…R$9.300*
Bordô / azul / preto 🍁

*18 pro Max 512gb…R$10.999*
Preto bordo

*18 pro Max 512gb…R$10.999*
Azul 🩵

*DUO 256gb…15.600*
Preto 🖤

*DUO 512gb…17.700*
Preto e branco`;

    const entries = parseSupplierPriceList(source);
    expect(entries).toHaveLength(20);
    expect(entries[0]).toMatchObject({ name: '15 128gb', cost: 4050, colors: ['Azul'] });
    expect(entries[0].aliases).toContain('iphone 15 128gb');
    expect(entries[2]).toMatchObject({ name: '16 128gb', cost: 4750, colors: ['Preto', 'Branco'] });
    expect(entries[3]).toMatchObject({ name: '17E 256gb', cost: 4250, colors: ['Rosa'] });
    expect(entries[4].colors).toEqual(['Branco', 'Verde']);
    expect(entries[6].colors).toEqual(['Azul', 'Roxo']);
    expect(entries[8]).toMatchObject({ cost: 8100, colors: ['Prata'] });
    expect(entries[11].colors).toEqual(['Bordô']);
    expect(entries[15].colors).toEqual(['Bordô', 'Azul', 'Preto']);
    expect(entries[16].cost).toBe(10999);
    expect(entries[19].colors).toEqual(['Preto', 'Branco']);
  });

  it('continua lendo a linha antiga com custo entre parênteses e cor na mesma linha', () => {
    const [entry] = parseSupplierPriceList('🇧🇷 *Galaxy A07 128GB - (R$ 750)* preto');
    expect(entry).toMatchObject({ name: 'Galaxy A07 128GB', cost: 750, colors: ['Preto'] });
  });

  it('continua lendo formato em bloco com nome, custo e cor em linhas separadas', () => {
    const [entry] = parseSupplierPriceList('Galaxy A07 128GB\nCusto: R$ 750\nPreto');
    expect(entry).toMatchObject({ name: 'Galaxy A07 128GB', cost: 750, colors: ['Preto'] });
  });

  it('usa a palavra de cor e ignora o emoji decorativo', () => {
    const [entry] = parseSupplierPriceList('*17 pro max 256gb…R$8.100*\nSilver ⚪️');
    expect(entry.colors).toEqual(['Prata']);
    const [cobre] = parseSupplierPriceList('*17 256gb…R$5.700*\nCobre 🟠');
    expect(cobre.colors).toEqual(['Cobre']);
    expect(cobre.unknownColors).toEqual([]);
  });

  it('lê nomes de cor em inglês compostos sem perder a linha', () => {
    const [entry] = parseSupplierPriceList('*18 pro max 256gb…R$9.300*\nSpace Black / Starlight');
    expect(entry.colors).toEqual(['Preto', 'Starlight']);
    const [deep] = parseSupplierPriceList('*18 pro max 256gb…R$9.300*\nDeep Blue 🩵');
    expect(deep.colors).toEqual(['Azul']);
  });

  it('registra cor desconhecida para bloquear em vez de aplicar preço no produto todo', () => {
    const [entry] = parseSupplierPriceList('*17 256gb…R$5.700*\nTangerina 🍊');
    expect(entry.colors).toEqual([]);
    expect(entry.unknownColors).toEqual(['Tangerina']);
  });

  it('não trata linha de aviso como cor', () => {
    const entries = parseSupplierPriceList('*17 256gb…R$5.700*\nAzul 🩵\nGaleria de fotos 📸\nConfira as novidades');
    expect(entries).toHaveLength(1);
    expect(entries[0].colors).toEqual(['Azul']);
    expect(entries[0].unknownColors).toEqual([]);
  });

  it('não herda a marca da seção em produto de outra marca', () => {
    const [duo] = parseSupplierPriceList('🍏REPOSIÇÃO APPLE🍏\n\n*DUO 512gb…17.700*\nPreto e branco');
    expect(duo.colors).toEqual(['Preto', 'Branco']);
    expect(duo.aliases).not.toContain('Apple DUO 512gb');
  });

  it('limpa reticências do nome no formato com custo e venda rotulados', () => {
    const [entry] = parseSupplierPriceList('*17 256gb…CUSTO: R$5.700 - VENDA: R$6.400*\nPreto 🖤');
    expect(entry).toMatchObject({ name: '17 256gb', cost: 5700, resale: 6400, colors: ['Preto'] });
    expect(entry.aliases).toContain('iphone 17 256gb');
  });
});
