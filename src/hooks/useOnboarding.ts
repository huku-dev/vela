import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '../contexts/AuthContext';

const STORAGE_KEY = 'vela_onboarded';

/**
 * Manages onboarding state: detection, step management, and completion.
 *
 * Checks localStorage first for instant client-side detection (avoids flash),
 * then syncs with Supabase profile (source of truth) when authenticated.
 */
export function useOnboarding() {
  const { isAuthenticated, supabaseClient } = useAuthContext();
  const [isOnboarded, setIsOnboarded] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  });
  const [isChecking, setIsChecking] = useState(!isOnboarded);

  // Sync with Supabase profile when authenticated
  useEffect(() => {
    if (!isAuthenticated || !supabaseClient || isOnboarded) {
      setIsChecking(false);
      return;
    }

    let cancelled = false;

    async function checkProfile() {
      try {
        const { data } = await supabaseClient!
          .from('profiles')
          .select('onboarding_completed')
          .single();

        if (!cancelled && data?.onboarding_completed) {
          localStorage.setItem(STORAGE_KEY, 'true');
          setIsOnboarded(true);
        }
      } catch {
        // Profile might not have the column yet — treat as not onboarded
      } finally {
        if (!cancelled) setIsChecking(false);
      }
    }

    checkProfile();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, supabaseClient, isOnboarded]);

  const completeOnboarding = useCallback(async () => {
    // Set localStorage immediately (instant on next visit)
    localStorage.setItem(STORAGE_KEY, 'true');
    setIsOnboarded(true);

    // Best-effort: update Supabase profile
    if (supabaseClient) {
      try {
        await supabaseClient
          .from('profiles')
          .update({ onboarding_completed: true })
          .eq('id', (await supabaseClient.auth.getUser()).data.user?.id);
      } catch {
        // Non-blocking — localStorage is the primary flag
      }
    }
  }, [supabaseClient]);

  return { isOnboarded, isChecking, completeOnboarding };
}
