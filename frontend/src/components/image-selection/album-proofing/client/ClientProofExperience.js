"use client";

import ExpiredClientLink from "@/components/shared/ExpiredClientLink";
import { expiredLinkFrom } from "@/lib/expiredLink.mjs";
import { useCallback, useEffect, useState } from "react";
import {
  clearProofSession, getProof, getProofMeta, getStoredProofSession, storeProofSession, verifyProofPin,
} from "@/services/image-selection/album-proof-client.service";
import ClientPinGate from "./ClientPinGate";
import ClientProofViewer from "./ClientProofViewer";

/**
 * The client's whole visit: the PIN gate, then the proof viewer. A stored session skips the gate
 * until the server says otherwise; every failure lands on a plain sentence, never a broken page.
 */
export default function ClientProofExperience({ token }) {
  const [meta, setMeta] = useState(null);
  const [sessionToken, setSessionToken] = useState(null);
  const [screen, setScreen] = useState("loading");
  const [error, setError] = useState("");
  // An expired link's details - checked before the PIN screen, so a lapsed link never asks for one.
  const [expiredLink, setExpiredLink] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await getProofMeta(token);
        if (!active) return;
        setMeta(response.data);
        const stored = getStoredProofSession(token);
        if (stored) {
          try {
            await getProof(token, stored);
            if (!active) return;
            setSessionToken(stored);
            setScreen("proof");
            return;
          } catch { clearProofSession(token); }
        }
        setScreen("gate");
      } catch (loadError) {
        if (active) { setExpiredLink(expiredLinkFrom(loadError)); setError(loadError.message || "This album proof is not available."); setScreen("error"); }
      }
    })();
    return () => { active = false; };
  }, [token]);

  const handlePin = useCallback(async (pin) => {
    const session = (await verifyProofPin(token, pin)).data.sessionToken;
    storeProofSession(token, session);
    setSessionToken(session);
    setScreen("proof");
  }, [token]);

  if (screen === "loading") return <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-6"><p className="text-sm text-slate-500">Loading your album proof...</p></main>;
  if (screen === "error" && expiredLink) return <ExpiredClientLink {...expiredLink} />;
  if (screen === "error") return <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-6"><p className="max-w-sm text-center text-sm text-slate-600">{error}</p></main>;
  if (screen === "gate") return <ClientPinGate meta={meta} onVerify={handlePin} />;
  return <ClientProofViewer token={token} sessionToken={sessionToken} meta={meta} />;
}
