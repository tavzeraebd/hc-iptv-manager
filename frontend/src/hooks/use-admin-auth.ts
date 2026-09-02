import { useCallback, useState } from "react";
import { hasPin, isUnlocked, lock as lockAuth, setPin as persistPin, verifyPin } from "@/lib/admin-auth";

export function useAdminAuth() {
  const [pinSet, setPinSet] = useState(() => hasPin());
  const [authed, setAuthed] = useState(() => isUnlocked());

  const createPin = useCallback(async (pin: string) => {
    await persistPin(pin);
    setPinSet(true);
    setAuthed(true);
  }, []);

  const unlock = useCallback(async (pin: string) => {
    const ok = await verifyPin(pin);
    if (ok) setAuthed(true);
    return ok;
  }, []);

  const lock = useCallback(() => {
    lockAuth();
    setAuthed(false);
  }, []);

  return { hasPin: pinSet, authed, createPin, unlock, lock };
}
