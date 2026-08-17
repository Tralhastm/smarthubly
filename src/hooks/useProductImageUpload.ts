import { supabase } from '@/integrations/supabase/client';

const compressImage = (file: File, maxWidth = 1200, quality = 0.8): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas not supported'));
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Compression failed'))),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
};

export const uploadProductImage = async (file: File, tenantId: string): Promise<string> => {
  const keepOriginal =
    file.type === 'image/svg+xml' ||
    file.type === 'image/gif' ||
    file.type === 'image/png' ||
    !file.type.startsWith('image/');

  let body: Blob = file;
  let contentType = file.type || 'application/octet-stream';
  let ext = (file.name.split('.').pop() || 'img').toLowerCase().replace(/[^a-z0-9]/g, '') || 'img';

  if (!keepOriginal) {
    try {
      body = await compressImage(file);
      contentType = 'image/jpeg';
      ext = 'jpg';
    } catch {
      // formatos que o navegador não decodifica (ex: HEIC) sobem originais
      body = file;
      contentType = file.type || 'application/octet-stream';
    }
  }

  const path = `${tenantId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from('product-images')
    .upload(path, body, { contentType, upsert: true });

  if (error) throw error;

  const { data } = supabase.storage.from('product-images').getPublicUrl(path);
  return data.publicUrl;
};

