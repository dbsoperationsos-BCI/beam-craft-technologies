"use client";

import { useCallback, useEffect, useState } from "react";
import { getMyWhatsappSession } from "@/services/sales/whatsapp-chat.service";
import { getMessageTemplateSwitches } from "@/services/settings/message-templates.service";

/**
 * Whether this person can send a WhatsApp message from their own paired account.
 *
 * Send WhatsApp is shown only to somebody who can use it: WhatsApp is on for the studio and for them,
 * and they have linked their own WhatsApp to the app. Anybody else is not offered the button at all -
 * pressing it would only be refused - and copies the message instead.
 *
 * `canSend` starts false and turns true only once the session says so, so the button never shows
 * and then disappears. A status request that fails leaves it false. The server still refuses a send
 * it should not allow; this decides only whether the button is drawn.
 *
 * `templateKey` names the message the button sends: while it is switched OFF under Settings →
 * Templates the button is absent too. A switch that cannot be read is taken as ON - the server
 * refuses an OFF message whatever the screen shows. `refresh` asks again - after somebody links
 * their WhatsApp on the same screen, so the button appears without reopening it.
 */
export default function useWhatsappSender(templateKey = null) {
  const [canSend, setCanSend] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    const switchedOn = templateKey
      ? getMessageTemplateSwitches().then((response) => response?.data?.[templateKey] !== false).catch(() => true)
      : Promise.resolve(true);
    void Promise.all([getMyWhatsappSession(), switchedOn])
      .then(([response, on]) => {
        if (cancelled) return;
        const session = response?.data || {};
        setCanSend(on && session.chatEnabled !== false && session.userChatEnabled !== false && session.status === "connected");
      })
      .catch(() => { if (!cancelled) setCanSend(false); });
    return () => { cancelled = true; };
  }, [templateKey, revision]);

  return { canSend, refresh };
}

/**
 * The same answer for several messages at once, from one look at the session and the switches - a
 * screen offering more than one message (the offboarding register's row menu). `canSend(key)` is
 * false until both are read, and a switch that cannot be read counts as ON, as above.
 */
export function useWhatsappSenders() {
  const [state, setState] = useState({ connected: false, switches: null });

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getMyWhatsappSession(), getMessageTemplateSwitches().then((response) => response?.data || {}).catch(() => ({}))])
      .then(([response, switches]) => {
        if (cancelled) return;
        const session = response?.data || {};
        setState({ connected: session.chatEnabled !== false && session.userChatEnabled !== false && session.status === "connected", switches });
      })
      .catch(() => { if (!cancelled) setState({ connected: false, switches: {} }); });
    return () => { cancelled = true; };
  }, []);

  const canSend = useCallback((key) => state.connected && state.switches !== null && state.switches[key] !== false, [state]);
  return { canSend };
}
