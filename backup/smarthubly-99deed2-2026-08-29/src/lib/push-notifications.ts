import { supabase } from '@/integrations/supabase/client';

const VAPID_PUBLIC_KEY = 'BC12lr2OMXKQzUIYDFU8AWHw0ZPAm0lIGvu439DBDy_1FYzuI8IEdp6g7yO1O7XM0TqNj_uTQlC6EX2WapGlzJ8';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

type Owner = { driverId?: string; supplierId?: string; tenantId?: string };

async function registerPushForOwner(owner: Owner): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push notifications not supported');
      return false;
    }
    try {
      if (window.self !== window.top) {
        console.warn('Skipping SW registration in iframe');
        return false;
      }
    } catch {
      return false;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    }

    const sub = subscription.toJSON();

    // Remove any old subscriptions with the same endpoint to avoid duplicates across owners
    // Remove any old subscriptions with the same endpoint to avoid duplicates across owners
    await (supabase as any).rpc('cleanup_push_subscription', {
      _endpoint: sub.endpoint!,
      _driver_id: owner.driverId ?? null,
      _supplier_id: owner.supplierId ?? null,
      _tenant_id: owner.tenantId ?? null,
    });

    await supabase.from('push_subscriptions').insert({
      driver_id: owner.driverId ?? null,
      supplier_id: owner.supplierId ?? null,
      tenant_id: owner.tenantId ?? null,
      endpoint: sub.endpoint!,
      p256dh: sub.keys!.p256dh!,
      auth: sub.keys!.auth!,
    } as any);

    return true;
  } catch (error) {
    console.error('Failed to register push:', error);
    return false;
  }
}

export async function registerPushSubscription(driverId: string): Promise<boolean> {
  return registerPushForOwner({ driverId });
}

export async function registerSupplierPushSubscription(supplierId: string): Promise<boolean> {
  return registerPushForOwner({ supplierId });
}

export async function registerTenantAdminPush(tenantId: string): Promise<boolean> {
  return registerPushForOwner({ tenantId });
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}
