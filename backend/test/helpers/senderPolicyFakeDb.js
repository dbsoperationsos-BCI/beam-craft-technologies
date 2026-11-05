/**
 * An in-memory stand-in for the two tables `automatic-whatsapp/senderPolicy.js` reads and writes -
 * `whatsAppSenderPolicy` and `whatsAppSenderPolicyMember` - and the `$transaction` it saves in. Spread
 * into a test's own fake client: `{ ...senderPolicyTables({ ATTENDANCE_REPORT: { sender: 7 } }, userOf), user: ... }`.
 *
 * `policies` seeds them: `{ [messageKey]: { mode = "SAME", sender, fallback = [], userIds = [], lastSenderUserId = null } }`
 * - `sender` the Sender mode's sender (by default the first of `userIds`), `fallback` its saved
 * fallback order, `userIds` the saved rotation order. The client's own `user.findMany` answers who has Allow WhatsApp, as the real one does.
 * `userOf(id)` answers the sender's `user` relation (`{ id, name, linkedEmployee }`, or null).
 * `failMarkSent` makes the last-sender update reject, as a database hiccup would.
 */
function senderPolicyTables(policies = {}, userOf = () => null, { failMarkSent = false } = {}) {
  const state = {
    policies: new Map(Object.entries(policies).map(([messageKey, policy]) => [messageKey, {
      messageKey,
      mode: policy.mode || "SAME",
      senderUserId: policy.sender !== undefined ? policy.sender : (policy.userIds?.[0] ?? null),
      lastSenderUserId: policy.lastSenderUserId ?? null,
    }])),
    members: Object.entries(policies).flatMap(([messageKey, policy]) => [
      ...(policy.userIds || []).map((userId, index) => ({ messageKey, list: "ROTATION", userId, position: index + 1 })),
      ...(policy.fallback || []).map((userId, index) => ({ messageKey, list: "FALLBACK", userId, position: index + 1 })),
    ]),
  };
  const tables = {
    whatsAppSenderPolicy: {
      async findUnique({ where }) {
        const row = state.policies.get(where.messageKey);
        if (!row) return null;
        const members = state.members
          .filter((member) => member.messageKey === where.messageKey)
          .sort((a, b) => a.position - b.position)
          .map((member) => ({ userId: member.userId, list: member.list }));
        return { ...row, sender: row.senderUserId ? userOf(row.senderUserId) : null, members };
      },
      async upsert({ where, update, create }) {
        const row = state.policies.get(where.messageKey);
        if (row) Object.assign(row, update);
        else state.policies.set(where.messageKey, { lastSenderUserId: null, senderUserId: null, ...create });
        return { ...state.policies.get(where.messageKey) };
      },
      async updateMany({ where, data }) {
        if (failMarkSent) throw new Error("database went away");
        const row = state.policies.get(where.messageKey);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    whatsAppSenderPolicyMember: {
      async deleteMany({ where }) {
        const before = state.members.length;
        state.members = state.members.filter((member) => member.messageKey !== where.messageKey);
        return { count: before - state.members.length };
      },
      async createMany({ data }) {
        state.members.push(...data.map((row) => ({ ...row })));
        return { count: data.length };
      },
    },
  };
  return {
    senderPolicyState: state,
    ...tables,
    async $transaction(callback) { return callback(tables); },
  };
}

module.exports = { senderPolicyTables };
