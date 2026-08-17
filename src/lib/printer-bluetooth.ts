/**
 * Impressão térmica via Web Bluetooth (Android/Chrome).
 * Suporta a maioria das impressoras BLE comuns (MTP, MPT-II, GOOJPRT, Knup, etc).
 *
 * IMPORTANTE: Web Bluetooth NÃO funciona em iOS (Safari). Funciona bem em:
 *  - Chrome/Edge no Android
 *  - Chrome/Edge no Desktop (Windows/Mac/Linux)
 */

// UUIDs comuns de impressoras térmicas BLE
const PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // mais comum (GOOJPRT/Knup/MTP)
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC
];

const PRINTER_CHARACTERISTICS = [
  '00002af1-0000-1000-8000-00805f9b34fb',
  '0000ff02-0000-1000-8000-00805f9b34fb',
  '0000ffe1-0000-1000-8000-00805f9b34fb',
  '49535343-8841-43f4-a8d4-ecbe34729bb3',
];

const STORAGE_KEY = 'lovable.printer.bluetoothId';

// Tipos Web Bluetooth não estão no lib.dom padrão de algumas configs
type BTDevice = any;
type BTChar = any;

let cachedDevice: BTDevice | null = null;
let cachedChar: BTChar | null = null;

export const isBluetoothSupported = (): boolean => {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
};

/**
 * Pareia uma impressora — abre o picker do navegador.
 * Lojista escolhe o dispositivo, e a referência fica salva pra próximas impressões.
 */
export async function pairPrinter(): Promise<{ name: string; id: string }> {
  if (!isBluetoothSupported()) {
    throw new Error('Bluetooth não é suportado neste navegador. Use Chrome no Android ou PC.');
  }

  const device = await (navigator as any).bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: PRINTER_SERVICES,
  });

  if (!device) throw new Error('Nenhum dispositivo selecionado');

  cachedDevice = device;
  localStorage.setItem(STORAGE_KEY, device.id);

  // Já conecta pra validar
  await connectToDevice(device);

  return { name: device.name || 'Impressora', id: device.id };
}

async function connectToDevice(device: BTDevice): Promise<BTChar> {
  const server = await device.gatt!.connect();

  // Tenta cada combinação de service/characteristic
  for (const serviceUuid of PRINTER_SERVICES) {
    try {
      const service = await server.getPrimaryService(serviceUuid);
      for (const charUuid of PRINTER_CHARACTERISTICS) {
        try {
          const char = await service.getCharacteristic(charUuid);
          if (char.properties.write || char.properties.writeWithoutResponse) {
            cachedChar = char;
            return char;
          }
        } catch { /* tenta próxima */ }
      }
    } catch { /* tenta próximo service */ }
  }

  throw new Error('Impressora encontrada mas não foi possível identificar o canal de impressão. Verifique o modelo.');
}

async function getCharacteristic(): Promise<BTChar> {
  // Já conectado?
  if (cachedChar && cachedDevice?.gatt?.connected) return cachedChar;

  // Tenta reusar dispositivo cacheado
  if (cachedDevice) return await connectToDevice(cachedDevice);

  // Tenta recuperar dispositivo previamente pareado (API getDevices não funciona em todos os browsers)
  const savedId = localStorage.getItem(STORAGE_KEY);
  if (savedId && (navigator as any).bluetooth.getDevices) {
    try {
      const devices: BTDevice[] = await (navigator as any).bluetooth.getDevices();
      const found = devices.find(d => d.id === savedId);
      if (found) {
        cachedDevice = found;
        return await connectToDevice(found);
      }
    } catch { /* fallback abaixo */ }
  }

  throw new Error('Nenhuma impressora pareada. Pareie uma impressora primeiro nas configurações.');
}

/**
 * Envia bytes ESC/POS para a impressora.
 * Quebra em chunks de 100 bytes (limite comum BLE).
 */
export async function printBytes(data: Uint8Array): Promise<void> {
  const char = await getCharacteristic();
  const chunkSize = 100;

  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const chunk = data.slice(offset, offset + chunkSize);
    if (char.properties.writeWithoutResponse) {
      await char.writeValueWithoutResponse(chunk);
    } else {
      await char.writeValue(chunk);
    }
    // Pequena pausa entre chunks
    await new Promise(r => setTimeout(r, 20));
  }
}

export const isPrinterPaired = (): boolean => {
  return !!localStorage.getItem(STORAGE_KEY);
};

export const forgetPrinter = (): void => {
  localStorage.removeItem(STORAGE_KEY);
  cachedDevice = null;
  cachedChar = null;
};
