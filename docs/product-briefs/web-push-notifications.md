# Web Push Notifications (C)

**Status:** Deferred. Spec held for future work, not currently scheduled. Phase 0 QA review identified two blockers (see §0) that must be resolved before any implementation is started.
**Author:** Claude + Henry, 2026-04-30.
**Sequence context:** Third leg of the missed-signal push-notification scoping. E (global pending banner) shipped 2026-04-29. B (T+2h reminder ping via Telegram and email) shipped 2026-04-30. C is the next layer for users who keep the dashboard tab closed. Decision was to ship E and B, observe their impact on the missed-signal rate, then revisit C if the gap is still material.

## 0. Phase 0 QA findings

A read-only adversarial reviewer ran a Phase 0 pass on this spec on 2026-04-30. Two must-fix issues kill the approach as originally written; the rest refine it. Folded into the spec below; recorded here as the durable record.

### Blockers (resolve before any code is written)

**B1. Deno + web-push library unresolved.** The send path depends on a working VAPID + ECE encryption implementation. The Node `web-push` library is not directly usable on Deno (Supabase edge runtime). Realistic options:
- `npm:web-push` via Deno's npm compat layer. Likely flaky under WORKER_RESOURCE_LIMIT, same family of issues that already constrained `breaking-news` (see the lazy-import comment in that file).
- Inline VAPID (ES256 JWT signing via Web Crypto) plus ECE payload encryption per RFC 8291 (ECDH on P-256 + HKDF + AES-128-GCM). Approximately 150-300 lines of crypto code. Needs adversarial review on its own.

This is the entire send path. A working spike is required before phases 2-5 are estimable. Until then, the original "~3 days total" estimate is fiction.

**B2. Shared-device privacy leak.** Push subscriptions are per-browser-profile, not per-site-user. Schema as originally drafted (UNIQUE on `endpoint` alone, upsert with `onConflict: 'endpoint'`) silently swaps `user_id` if user A and user B both subscribe from the same shared browser. User A's subsequent pushes route to user B. Fix: unique constraint on `(user_id, endpoint)`, and the push-subscription endpoint must explicitly delete any other user's row with the same endpoint inside the same transaction. Schema and endpoint design in §4 and §8 below reflect the fix.

### Should-reconsider items (folded into the spec)

- New-user permission gate originally excluded onboarding. A user with no proposals yet would never see the prompt, missing exactly the case where push is most valuable (their first proposal). §7 now includes a post-onboarding trigger and an always-on opt-in path inside `/account`.
- Send-path concurrency was unbounded. With a power user on multiple devices, parallel sends inside `notifyTradeProposal` could blow WORKER_RESOURCE_LIMIT. §5 now caps concurrency and clarifies await semantics.
- Daily cleanup cron was too lax. Hourly cleanup is trivial in cost and avoids dead subscriptions accumulating wasted send attempts. §10 updated.
- RLS policy was SELECT-only. INSERT/UPDATE/DELETE policies need to be explicit or all writes confined to service role. §4 updated.
- Adversarial gaps: endpoint URL was not validated against known push provider hosts (attacker could register `attacker.com` to harvest VAPID-signed payloads); no per-user subscription count cap; rate-limiting did not use the shared `check_rate_limit` RPC convention. §17 expanded.
- Tag-dedup behaviour was misstated. `tag` + `renotify: true` shows one notification card per device but alerts twice on a quiet device. §5 clarified.
- Phase 1 was not end-to-end testable without an admin "send test push" tool. §13 absorbs that into phase 1 scope.

### Revised effort estimate

Realistic build estimate: **5-7 days**, weighted toward phase 1 if inline crypto is required. The original 3-day figure assumed `web-push` would work; that assumption needs the spike before it can stand.

### Resolved open questions (no longer in §15)

- Click-through deep link: defer to banner-E's existing behaviour. Push for a single proposal navigates to `/trades` and scrolls to the card.
- iOS coverage: PWA install path stays out of scope for this work. Document the constraint in the settings UI. If user analytics later show that the iOS share is large enough that the design is half-finished without it, reopen as a separate effort.

## 1. Problem

Even with B sending a Telegram and email at T+2h, semi_auto users miss proposals when:

- They use email infrequently and don't have Telegram linked.
- They keep Vela in a desktop browser tab but ignore email/Telegram.
- They want a fast desktop notification without waiting for the email path.

Web push fills the gap by surfacing the proposal directly on the user's device when their browser is running, without requiring the tab to be focused.

## 2. Non-goals

- iOS Safari mobile push without a PWA install. Apple requires the user to add the site to home screen first. We accept this constraint and document it; we do not build a PWA shell as part of this work.
- Replacing Telegram or email. Push is additive. The user can opt in to push without opting out of either existing channel.
- In-tab notifications when the tab is focused. The existing global banner (E) already handles that.

## 3. Architecture overview

```
Browser (Service Worker)  ←  Push payload (encrypted)  ←  proposal-reminder /
                                                          notifyTradeProposal
       ↑
       │ subscription register
       │
Frontend (useWebPush hook)  →  POST /functions/v1/push-subscription
                                       │
                                       ↓
                              push_subscriptions table
                                       │
                                       │ joined to user_preferences for opt-out
                                       ↓
                              VAPID-signed POST to subscription.endpoint
```

Three new pieces:

1. **Service Worker** at `/public/sw.js` — receives push events, renders system notifications, handles click-to-open.
2. **Subscription endpoint** `proposal-reminder` sibling: a new edge function `push-subscription` that registers and updates subscriptions per user, per device.
3. **Send path** — `notifyTradeProposal` and `sendStaleProposalReminders` gain a parallel push-send branch alongside Telegram and email.

## 4. Schema

### New table `push_subscriptions`

```sql
CREATE TABLE public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES profiles(privy_did) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  failed_at TIMESTAMPTZ DEFAULT NULL,
  UNIQUE (user_id, endpoint)
);

CREATE INDEX idx_push_subscriptions_user ON public.push_subscriptions(user_id) WHERE failed_at IS NULL;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Read: users see their own subscriptions
CREATE POLICY "users read own subscriptions" ON push_subscriptions
  FOR SELECT USING (auth.jwt() ->> 'sub' = user_id);

-- Writes: confined to service role (edge functions). The push-subscription
-- endpoint validates user identity from the auth header and writes via
-- service role. Direct client writes are not supported.
-- If we ever expose direct client writes, add INSERT/UPDATE/DELETE policies
-- with a `WITH CHECK (auth.jwt() ->> 'sub' = user_id)` guard.
```

The unique constraint is on `(user_id, endpoint)` rather than `endpoint` alone. This addresses the shared-device privacy leak from §0. Two users on the same browser profile each get their own row; the push-subscription endpoint additionally deletes any other user's row with the same `endpoint` (see §8) so a stolen browser session can't continue receiving the previous user's pushes.

### `user_preferences.notifications_push BOOLEAN DEFAULT true`

Mirrors the existing `notifications_telegram` and `notifications_email` semantics. Default opt-in once the user has at least one active subscription. Settings toggle flips this off without deleting subscriptions.

## 5. Send-path integration

`notifyTradeProposal` (in `_shared/notify.ts`) and `sendStaleProposalReminders` both gain a parallel branch. Per §0 B1, `sendWebPush` itself is the open implementation question (npm:web-push compat layer vs inline VAPID + ECE) and must be settled by the spike before this branch is wired up.

```ts
if (channels.pushOptedIn) {
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId)
    .is("failed_at", null)
    .limit(MAX_SUBSCRIPTIONS_PER_USER); // see §17

  // Concurrency cap: a power user with 5 devices receiving N concurrent
  // proposals can otherwise add 5N parallel HTTPS posts inside an already
  // tight worker. breaking-news is already at the WORKER_RESOURCE_LIMIT
  // edge; we will not push other functions over it.
  const limit = pLimit(3);
  const sendTasks = (subs ?? []).map(sub =>
    limit(() =>
      sendWebPush(sub, payload).catch(err => {
        // 410 Gone or 404: subscription is dead. Mark failed_at; the
        // hourly cleanup cron deletes after 24h.
        if (err.statusCode === 410 || err.statusCode === 404) {
          return supabase
            .from("push_subscriptions")
            .update({ failed_at: new Date().toISOString() })
            .eq("user_id", userId)
            .eq("endpoint", sub.endpoint);
        }
        // Other errors (timeouts, 5xx): log only, do not retry. Push is
        // best-effort and the existing email/Telegram channels still run
        // in parallel.
        console.warn("[notify] sendWebPush failed", { statusCode: err.statusCode });
      })
    )
  );

  // Push tasks join the existing tasks array used by Telegram and email.
  // Outer Promise.allSettled ensures one slow provider does not stall the
  // others. We do NOT block notify return on push completion; tasks are
  // awaited inside the same allSettled the existing channels use.
  tasks.push(...sendTasks);
}
```

The `.eq("user_id", userId)` filter on the failure update is critical alongside `endpoint`: with the composite unique constraint from §4, the same `endpoint` can appear under two different `user_id`s, so updating by endpoint alone would mark the wrong row.

`pLimit` is the standard `p-limit` package or an inline equivalent (~20 lines). The cap is per-call, not global, so two concurrent notify calls each get their own pool of 3.

### Payload shape

```json
{
  "title": "AAPL · LONG pending",
  "body": "Tap to review. Expires in 1h 47m.",
  "url": "/trades",
  "tag": "proposal-{proposalId}",
  "renotify": true
}
```

The `tag` collapses successive pushes for the same proposal into a single notification card per device (creation push at T+0, reminder push at T+2h end up as one card, not two stacked). With `renotify: true`, the device still alerts (sound, buzz) on each fresh push even though the visible card is replaced. This is intentional for the reminder case: the user did not act on the first, so a second alert is appropriate. For the rare case of multiple distinct proposals arriving in rapid succession, each gets its own `tag` and therefore its own card and alert.

### Payload shape

```json
{
  "title": "AAPL · LONG pending",
  "body": "Tap to review. Expires in 1h 47m.",
  "url": "/trades",
  "tag": "proposal-{proposalId}",
  "renotify": true
}
```

The `tag` lets a fresh notification for the same proposal replace an older one (e.g., proposal creation push then T+2h reminder push for the same proposal end up as one notification, not two stacked).

## 6. Service Worker

Single file at `/public/sw.js`. Handles two events:

```js
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/vela-mark-192.png',
      badge: '/icons/vela-badge-72.png',
      tag: data.tag,
      renotify: data.renotify,
      data: { url: data.url }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(clients.openWindow(url));
});
```

No persistent state in the SW. Registered from the frontend on app load when the user is authenticated and has push enabled.

## 7. Frontend permission flow

The friction point. Asking on first visit is the failure mode that gets sites permanently blocked.

**Trigger:** show the prompt only after one of:
- User has at least one pending proposal at any point (proposal exists in their feed)
- User has interacted with the global banner (E) once
- User has completed onboarding and accumulated at least 30 minutes of session time across visits (catches new users who have not yet seen their first proposal but who are clearly engaged)
- User explicitly toggles "enable push" in /account/notifications

The fourth trigger is critical for the new-user case: a fresh sign-up with no proposals yet would otherwise never see the prompt and would miss exactly the first proposal the system fires. The session-time threshold lets the prompt land before the first proposal, while still avoiding the "ask on first visit" anti-pattern.

The `/account/notifications` toggle is always available regardless of trigger state, so a user who knows they want push can opt in immediately.

**Component sketch:**

```tsx
// src/hooks/useWebPushPrompt.ts
export function useWebPushPrompt() {
  const { proposals } = useTrading();
  const hasPending = proposals.some(p => p.status === 'pending');
  const dismissedRecently = localStorage.getItem('push_prompt_dismissed_until');

  if (
    'Notification' in window &&
    Notification.permission === 'default' &&
    hasPending &&
    !dismissedRecently
  ) {
    return { show: true, request: requestPushPermission };
  }
  return { show: false };
}
```

The prompt is a small toast or banner row, NOT a `<dialog>`. Copy:

> **Get notified when proposals arrive**
> One tap, on this device. Won't ping you when the tab is open.
> [Enable] [Maybe later]

"Maybe later" sets a 7-day cooldown in localStorage. "Enable" calls `Notification.requestPermission()`, then on grant calls `pushManager.subscribe()` and POSTs the subscription to `push-subscription`.

## 8. Edge function `push-subscription`

```ts
Deno.serve(async (req) => {
  // POST: register or refresh a subscription
  // DELETE: unsubscribe
  const body = await req.json();
  const userId = await resolveUserFromAuthHeader(req);

  // Rate limit using the project-wide check_rate_limit RPC, not a
  // bespoke counter. Convention is shared across endpoints. See §17.
  const allowed = await checkRateLimit(supabase, {
    user_id: userId,
    bucket: "push_subscription",
    limit: 10,
    window_seconds: 3600,
  });
  if (!allowed) return new Response("rate limited", { status: 429 });

  // Validate the endpoint host against the known push provider list.
  // A user-supplied endpoint is otherwise an exfiltration vector for
  // VAPID-signed payloads (see §17).
  if (!isValidPushEndpoint(body.endpoint)) {
    return new Response("invalid endpoint", { status: 400 });
  }

  if (req.method === 'POST') {
    // Step 1: clear any other user's subscription pointing at the same
    // endpoint. Push subscriptions are per-browser-profile; if user A
    // signed out and user B logged in on the same browser, the same
    // endpoint will appear under both user_ids without this step.
    // Without it, A's old row continues to receive A's pushes while
    // B's interface shows them as B's, leaking A's signal data to B's
    // device (see §0 B2).
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', body.endpoint)
      .neq('user_id', userId);

    // Step 2: enforce per-user subscription cap. Drop the oldest if at
    // limit. See §17 — without this a user could fan out the send loop
    // by registering hundreds of dead endpoints.
    const { count } = await supabase
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if ((count ?? 0) >= MAX_SUBSCRIPTIONS_PER_USER) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('user_id', userId)
        .order('last_seen_at', { ascending: true })
        .limit(1);
    }

    // Step 3: upsert the current user's subscription. The composite
    // UNIQUE (user_id, endpoint) means the same user re-registering
    // refreshes last_seen_at and clears failed_at without duplication.
    await supabase
      .from('push_subscriptions')
      .upsert({
        user_id: userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        user_agent: req.headers.get('user-agent'),
        last_seen_at: new Date().toISOString(),
        failed_at: null
      }, { onConflict: 'user_id,endpoint' });
    return new Response(JSON.stringify({ ok: true }));
  }

  if (req.method === 'DELETE') {
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', body.endpoint)
      .eq('user_id', userId);
    return new Response(JSON.stringify({ ok: true }));
  }
});
```

Auth: standard auth-exchange handshake, same as other authed endpoints. The user can only register or delete subscriptions for their own user_id (server-side eq filter plus the user-swap delete in step 1). RLS on the table is read-only by design (see §4); writes go through this edge function exclusively.

## 9. VAPID keys

Generate once, store as Supabase secrets:

- `VAPID_PUBLIC_KEY` — embedded in the frontend bundle (public, safe to expose)
- `VAPID_PRIVATE_KEY` — backend secret, used to sign push payloads

Generate via `npx web-push generate-vapid-keys`. Set in Supabase secrets:

```
supabase secrets set VAPID_PUBLIC_KEY=B... --project-ref dikybxkubbaabnshnreh
supabase secrets set VAPID_PRIVATE_KEY=... --project-ref dikybxkubbaabnshnreh
```

Frontend reads `import.meta.env.VITE_VAPID_PUBLIC_KEY` (set in Vercel env). Update `.env.example`, `DEPLOY.md`, and the Vercel env table per project rule 4.

## 10. Failure handling

- **410 Gone or 404** on send → subscription is dead (browser cleared it, user uninstalled, browser profile wiped, etc.). Mark `failed_at` immediately. **Hourly** cleanup cron `push-subscription-cleanup` deletes rows with `failed_at < NOW() - INTERVAL '24 hours'`. Hourly cadence (vs daily in the original draft) keeps dead rows from accumulating wasted send attempts. The 24h window leaves room for transient failures to recover (a row that flips back to non-failed on a successful re-subscribe stays alive).
- **Network error** on send → log and continue. Push is best-effort. The existing email and Telegram channels still run in parallel inside the same notify call, so a failed push does not silence the user.
- **413 Payload Too Large** → unlikely given the small JSON. Defensive truncation of `title` and `body` to safe lengths happens at format time.
- **VAPID signature error** → fail loud. This indicates the private key is misconfigured. Surface via admin Telegram alert and Sentry.
- **Re-subscribe collision** → if a user re-subscribes on the same browser session right after a revoke + re-grant, the browser may return the same endpoint. The `(user_id, endpoint)` upsert handles this: existing row's `failed_at` is reset to NULL and `last_seen_at` refreshed. No duplicate row created.

## 11. Platform matrix

| Platform | Web Push? | Notes |
|---|---|---|
| Chrome (desktop, mobile) | ✓ | Standard support |
| Firefox (desktop, mobile) | ✓ | Standard support |
| Edge | ✓ | Standard support |
| Safari macOS 16+ | ✓ | Works without PWA |
| Safari iOS 16.4+ | ✓ only as PWA | Must add site to home screen |
| iOS in-app browser | ✗ | No web push at all |

Document the iOS-only-as-PWA caveat in the settings UI: "iPhone users: tap Share, then Add to Home Screen to enable notifications."

## 12. Privacy and opt-out

- `push_subscriptions` is RLS-protected. Service role bypass is only used by edge functions for sending.
- `notifications_push` flag in `user_preferences` controls whether new pushes are sent. Setting it to `false` does NOT delete subscriptions (so re-enabling is one toggle, not a re-grant of browser permission).
- "Disable on all devices" button in /account/notifications wipes subscriptions and sets the flag to false.
- Subscription endpoint is PII-ish (it identifies a specific browser instance). Don't log it raw; log a short hash for debugging.

## 13. Phases

Estimates revised after Phase 0 QA. Original "~3 days" assumed `web-push` would work on Deno; that assumption is unproven. Phase 1 absorbs the spike, the schema, the endpoint, the SW, and an admin "send test push" tool so phase 1 can be exercised end-to-end without phase 2 blocking it.

| Phase | Scope | Estimate |
|---|---|---|
| 0 | Spike: prove `sendWebPush` works under Supabase edge runtime. Compare `npm:web-push` compat layer vs inline VAPID + ECE encryption. Pick one with adversarial review. **Output:** a working `sendWebPush(sub, payload)` helper. | 1-2 days |
| 1 | Schema + push-subscription edge function (with user-swap delete, host whitelist, subscription cap, shared rate limiter) + frontend hook + Service Worker file + admin "send test push" endpoint. End: an admin can send a test push to themselves, see it land, and confirm tap navigates correctly. | 1-1.5 days |
| 2 | Wire `sendWebPush` into `notifyTradeProposal` with `pLimit(3)` and the failure handler. End: opted-in users get a push when a fresh proposal is created. | half day |
| 3 | Wire push into `sendStaleProposalReminders`. End: opted-in users get a push at T+2h. | 2-3 hours |
| 4 | Settings UI in /account/notifications, opt-in prompt logic with cooldown and the four triggers from §7, browser-revoked-permission detection. End: full UX loop. | 1 day |
| 5 | Hourly cleanup cron + monitoring (send-failure rates, subscription growth/churn) + adversarial test pass on the crypto path. End: dead subscriptions GC'd, ops visibility. | half day |

**Total: 5-7 days of build work**, weighted toward phase 0 if inline crypto ends up being necessary. Most of phases 4 and 5 can be parallelised once phase 2 lands.

## 14. Acceptance criteria

- User can enable push in /account/notifications. Browser prompt appears. On grant, subscription POSTs to `push-subscription` and a row exists in the table under their `user_id`.
- Creating a proposal triggers a push to all the user's active subscriptions (alongside Telegram and email).
- T+2h reminder triggers a push (alongside the existing channels).
- Tapping a push notification navigates to /trades and scrolls to the relevant proposal card (matches banner-E behaviour).
- Toggling push off in /account immediately stops new pushes via the `notifications_push` flag; toggling back on does NOT re-prompt the browser when an active subscription still exists.
- view_only and full_auto users do not receive proposal pushes (mirrors the B reminder logic).
- 410 Gone or 404 errors mark `failed_at`; hourly cleanup cron deletes rows where `failed_at < NOW() - INTERVAL '24 hours'`.
- iOS Safari users see the PWA-install hint when they try to enable push outside a PWA context.
- **Shared device:** when user A is logged in and subscribes, then signs out, then user B signs in on the same browser and subscribes, the original endpoint is reassigned to user B and user A no longer receives pushes via that browser profile.
- **Browser-revoked permission:** when `Notification.permission` flips from `granted` to `denied` outside the app, the next app load detects this, deletes the local subscription via `pushManager.unsubscribe()`, and DELETEs the row server-side.
- **Per-user cap:** a user attempting to register beyond `MAX_SUBSCRIPTIONS_PER_USER` (10) sees the oldest of their subscriptions evicted automatically.
- **Endpoint validation:** a POST to `push-subscription` with an endpoint host outside the allowlist returns 400.

## 15. Open questions

Resolved in §0 and folded into the spec body:
- ~~Click-through deep link~~ → defer to banner-E's behaviour (see §14 AC).
- ~~Web Push library on Deno~~ → promoted to phase 0 spike (see §13 and §0 B1). Not "open" anymore; it is the gating decision.

Still open, settle before phase 0:

1. **Notification grouping for multiple distinct proposals.** If 3 fresh proposals fire within a single signal cycle (e.g. multiple assets crossing simultaneously on the 4H scan), each gets its own `tag` and therefore its own card and alert. On a quiet device that is three buzzes inside a minute. Acceptable for desktop, potentially noisy on mobile. Decision needed: keep separate (current default), bundle into a single summary push, or rate-limit to one push per N seconds per user. Recommend keep separate for v1; revisit if user feedback flags it.
2. **VAPID key rotation policy.** Rotating the VAPID key invalidates all existing subscriptions and requires every user to re-grant browser permission. Default policy: do not rotate unless the private key is suspected leaked. If rotation is forced, the recovery path is (a) bulk-delete `push_subscriptions`, (b) ship the new public key in the next frontend deploy, (c) accept that users will need to re-enable. Documented here so the recovery path is not improvised mid-incident.
3. **Quiet hours.** A per-user quiet-hours window for proposals that arrive at 3am local time. Out of scope for v1; flag for a follow-up if churn data suggests overnight pings are driving opt-outs.
4. **Multi-device behaviour confirmation.** A user with 2 desktops + 1 phone gets the same push three times (one per device). The shared `tag` collapses to one card per device, not three on each. Behaviour is intentional but worth confirming with a user test before declaring acceptable.

## 16. Out of scope (separate work)

- PWA manifest and install flow for iOS (would unlock iOS push but is a bigger surface).
- In-app notification center (a `/notifications` page listing past notifications). Push is push; the audit trail can come later if users ask.
- Sound on successful trade placement (separate idea Henry flagged during E scoping). Decide before or after C.

## 17. Adversarial questions to revisit at build time

Constants used below:
- `MAX_SUBSCRIPTIONS_PER_USER = 10` (§8 enforces this on POST)
- `PUSH_ENDPOINT_HOST_ALLOWLIST` = suffix list `[".googleapis.com", ".mozilla.com", ".windows.com", ".apple.com"]` (the four major push providers; any others would need an explicit add)

Threats and mitigations:

- **Replay attack — registering another user's subscription.** The endpoint URL alone does not authorize sending; VAPID-signed delivery requires our private key. Server-side, the user_id is taken from the auth header, not the request body. RLS plus the explicit `user_id` filter on writes prevents cross-user writes.
- **Subscription leak.** If the `push_subscriptions` table contents leak, attackers cannot deliver pushes (no VAPID private key) but the endpoint URLs reveal each user's push provider and a per-device fingerprint. Rotate the VAPID key under §15 Q2 if the leak occurs. Endpoint values are not logged in plaintext anywhere outside the table; debug logs use a short hash of the endpoint.
- **Endpoint exfiltration via attacker-controlled host.** Without validation, a user could register `endpoint=https://attacker.com/log` and receive their own VAPID-signed payloads, which they could forward and reverse-engineer signing patterns. The `isValidPushEndpoint` check in §8 enforces the host allowlist; a 400 is returned for anything else.
- **DoS via subscription floods.** The shared `check_rate_limit` RPC limits `push-subscription` POSTs to 10/hr per user. The per-user subscription cap (`MAX_SUBSCRIPTIONS_PER_USER = 10`) prevents a determined user from inflating the send loop with hundreds of dead endpoints over time. The hourly cleanup cron caps the dead-row tail.
- **Permission spam after revoke.** If a user revokes browser permission, the next app load checks `Notification.permission`. On `denied`, the frontend calls `pushManager.unsubscribe()` and DELETEs the server-side row. The server treats the row as authoritative for routing, so this single check is sufficient.
- **Shared-device user swap.** Per §0 B2 and §8, the push-subscription POST deletes any other user's row pointing at the same endpoint before upserting. This means a stolen browser session cannot continue receiving the previous user's pushes once the new user subscribes. There is still a window between "previous user signs out" and "new user subscribes" where the previous user's row remains in the table; if the previous user is offline at that moment, no leak occurs because the device is not subscribed under their account anymore (browser permission is per-origin, not per-account, but the `pushManager.getSubscription()` flow on the new account will register a fresh subscription that triggers the swap delete).
- **Adversarial test path.** Even though push is not a financial flow per the project's `FEATURE-ADV:` rule, the inline crypto path (if phase 0 picks the inline option over `npm:web-push`) introduces a non-trivial attack surface. Adversarial tests for the crypto path are in scope for phase 5 and should at minimum cover (a) malformed VAPID JWT signing, (b) ECE payload truncation, (c) p256dh / auth value tampering at registration time.
