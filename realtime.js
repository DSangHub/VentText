// api/_lib/realtime.js
// Real-time push so the merchant dashboard updates live instead of on refresh.
//
// This is the layer the architecture doc calls out (step 6). It's wired to
// Pusher, but degrades gracefully: if the PUSHER_* env vars aren't set, publish()
// simply logs and no-ops, so the rest of the system works without it. Pusher is
// an optionalDependency, so a missing package never crashes a deploy either.
//
// To turn it on: create a free Pusher Channels app and set
//   PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER
// The dashboard subscribes to the channel `merchant-<merchantId>` and listens
// for the `new-message` event.

let pusherClient;
let triedInit = false;

async function getPusher() {
  if (triedInit) return pusherClient;
  triedInit = true;

  const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env;
  if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET || !PUSHER_CLUSTER) {
    return null; // Not configured — publish() will no-op.
  }

  try {
    const mod = await import('pusher');
    const Pusher = mod.default || mod;
    pusherClient = new Pusher({
      appId: PUSHER_APP_ID,
      key: PUSHER_KEY,
      secret: PUSHER_SECRET,
      cluster: PUSHER_CLUSTER,
      useTLS: true,
    });
  } catch (err) {
    console.warn('Pusher configured but package not installed; skipping realtime.', err.message);
    pusherClient = null;
  }
  return pusherClient;
}

/**
 * Publish a real-time event for a merchant's dashboard channel.
 * Never throws — a realtime failure must not break the SMS pipeline.
 */
export async function publish(merchantId, event, data) {
  if (!merchantId) return;
  try {
    const client = await getPusher();
    if (!client) {
      console.log(`[realtime] (no-op) merchant-${merchantId} ${event}`, data);
      return;
    }
    await client.trigger(`merchant-${merchantId}`, event, data);
  } catch (err) {
    console.warn('Realtime publish failed (non-fatal):', err.message);
  }
}

export function newMessageEvent(merchantId, conversationId, message) {
  return publish(merchantId, 'new-message', { conversationId, message });
}
