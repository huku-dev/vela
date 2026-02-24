import { useState, useCallback } from 'react';
import { useAuthContext } from '../contexts/AuthContext';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export type DeleteStep = 'idle' | 'warning' | 'confirm' | 'deleting' | 'done' | 'error';

export interface AccountDeleteState {
  step: DeleteStep;
  error: string | null;
  deletionScheduledAt: string | null;
  /** Move to warning step */
  startDelete: () => void;
  /** Move to confirm step (user saw warnings) */
  proceedToConfirm: () => void;
  /** Execute soft-delete (user typed DELETE) */
  confirmDelete: () => Promise<void>;
  /** Cancel and reset to idle */
  cancel: () => void;
  /** Reactivate a deactivated account */
  reactivate: () => Promise<void>;
  reactivating: boolean;
}

export function useAccountDelete(): AccountDeleteState {
  const { getToken, logout } = useAuthContext();
  const [step, setStep] = useState<DeleteStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [deletionScheduledAt, setDeletionScheduledAt] = useState<string | null>(null);
  const [reactivating, setReactivating] = useState(false);

  const startDelete = useCallback(() => setStep('warning'), []);
  const proceedToConfirm = useCallback(() => setStep('confirm'), []);
  const cancel = useCallback(() => {
    setStep('idle');
    setError(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    setStep('deleting');
    setError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${SUPABASE_URL}/functions/v1/account-delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: 'user_requested' }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete account');
      }

      const data = await res.json();
      setDeletionScheduledAt(data.deletion_scheduled_at);
      setStep('done');

      // Auto-logout after 3 seconds
      setTimeout(() => {
        logout();
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStep('error');
    }
  }, [getToken, logout]);

  const reactivate = useCallback(async () => {
    setReactivating(true);
    setError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${SUPABASE_URL}/functions/v1/account-reactivate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to reactivate account');
      }

      // Force full page reload to re-run auth-exchange with fresh profile
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setReactivating(false);
    }
  }, [getToken]);

  return {
    step,
    error,
    deletionScheduledAt,
    startDelete,
    proceedToConfirm,
    confirmDelete,
    cancel,
    reactivate,
    reactivating,
  };
}
