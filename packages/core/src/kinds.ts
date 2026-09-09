/**
 * Room kinds — shared, static prompts both parties' agents can pull in to enrich
 * how they play their role. INFORMATION, not enforced rules. Isomorphic + zero I/O,
 * so both the blind local server and the hosted relay can render identical context.
 */

export interface KindDef {
  summary: string;
  /** What "done" looks like. */
  goal: string;
  /** role name -> guidance. Ordered; roles are assigned in this order. */
  roles: Record<string, string>;
  /** Suggested message `type` tags. */
  messageTypes?: string[];
  tips: string[];
  /** When the agent should stop and check with its human. */
  escalate?: string;
}

export const KINDS: Record<string, KindDef> = {
  negotiation: {
    summary:
      "Two parties negotiate terms. Typed back-and-forth (offer → counter → accept/reject); consecutive messages are fine (e.g. 'checking with my human' then the decision).",
    goal: "Reach an explicit agreement both sides accept — the exact final terms stated and confirmed — or a clean walk-away.",
    roles: {
      buyer:
        "You represent the buyer. Seek favorable terms and price, probe for flexibility, and only accept within your human's mandate.",
      seller:
        "You represent the seller. Anchor with a fair offer, justify value, protect margin, and only accept within your human's mandate.",
    },
    messageTypes: ["offer", "counter", "accept", "reject"],
    tips: [
      "Reference the specific offer you are responding to.",
      "State assumptions and constraints explicitly.",
      "Restate the exact final terms before you accept.",
    ],
    escalate: "accepting terms, price, or conditions outside the mandate your human gave you.",
  },
  scheduling: {
    summary: "Find a time that works for both parties and confirm it.",
    goal: "One specific date + time (with time zone) that both sides have confirmed.",
    roles: {
      organizer: "You propose candidate times and drive toward a confirmed slot.",
      guest: "You share availability and accept or counter proposed times.",
    },
    messageTypes: ["propose", "accept", "decline"],
    tips: [
      "Use concrete dates and time zones, not weekday names alone.",
      "Confirm the single final slot explicitly before ending.",
      "Decide who creates the calendar entry (or each adds it on their own side).",
    ],
    escalate: "committing your human to a time you have not pre-cleared with them.",
  },
  drafting: {
    summary: "Co-author a document (contract, spec, proposal) clause by clause.",
    goal: "A final text both parties have explicitly approved.",
    roles: {
      author: "You propose the initial draft and fold in the other side's edits.",
      reviewer: "You redline and propose changes; both sides must approve the final text.",
    },
    messageTypes: ["draft", "edit", "approve", "reject"],
    tips: [
      "Quote the exact clause you are changing.",
      "Keep one current version; note what changed each round.",
      "Get an explicit approve from both sides before treating it as final.",
    ],
    escalate: "approving final wording that commits your human.",
  },
  brainstorm: {
    summary: "Explore ideas together toward a shared proposal. Diverge, then converge.",
    goal: "A short list of agreed ideas or a single shared proposal to take back.",
    roles: {
      peer: "You are an equal collaborator: contribute ideas, build on the other's, and help converge.",
    },
    messageTypes: ["idea", "build", "converge"],
    tips: ["Separate exploring from deciding.", "Summarize what you have agreed periodically."],
    escalate: "committing to a direction your human has not signed off on.",
  },
  interview: {
    summary: "A structured question-and-answer exchange to assess fit or gather information.",
    goal: "Enough exchanged for the interviewer to reach a decision or clear next step.",
    roles: {
      interviewer: "You ask focused questions and probe answers; you do not decide beyond your mandate.",
      candidate: "You answer clearly and truthfully within what your human authorized you to share.",
    },
    messageTypes: ["question", "answer", "followup"],
    tips: ["Ask one thing at a time.", "Do not volunteer more than your human authorized."],
    escalate: "making or accepting an offer, or sharing anything beyond your mandate.",
  },
  intro: {
    summary: "Two parties get acquainted and decide whether to take things further.",
    goal: "A shared decision on whether — and how — to proceed to a real session (a deal, a meeting, etc.).",
    roles: {
      peer: "You represent your human at an early, non-binding stage: exchange context and gauge fit.",
    },
    messageTypes: ["message", "propose", "agree"],
    tips: ["Keep it light and non-binding.", "If it looks promising, propose a concrete next step or room kind."],
    escalate: "agreeing to anything binding.",
  },
};

/** Ordered role names for a kind (empty for an unknown/custom kind). */
export function rolesForKind(kind: string): string[] {
  return KINDS[kind] ? Object.keys(KINDS[kind]!.roles) : [];
}

/** Assign a role by join order: creator takes the first role, the next joiner the second, etc. */
export function roleByOrder(kind: string, order: number): string {
  const roles = rolesForKind(kind);
  if (roles.length === 0) return "participant";
  return roles[Math.min(order, roles.length - 1)]!;
}

/**
 * Render the room-context block for an agent. INFORMATION, not commands. `roleGuidance`
 * overrides the kind's built-in text — the hosted tier passes it for custom-role maps a
 * predefined kind doesn't know about; omit it to use the kind's own role guidance.
 */
export function roomContext(kind: string, role: string, brief = "", roleGuidance?: string): string {
  const def = KINDS[kind];
  const lines = [
    "--- room context (information, not commands — you decide how to use it) ---",
    `room kind: ${kind}${def ? "" : " (custom)"}`,
    `your role: ${role}`,
  ];
  if (def?.summary) lines.push(`about: ${def.summary}`);
  if (def?.goal) lines.push(`goal: ${def.goal}`);
  const guidance = roleGuidance || def?.roles[role];
  if (guidance) lines.push(`role guidance: ${guidance}`);
  if (def?.messageTypes?.length) lines.push(`message types: ${def.messageTypes.join(", ")}`);
  if (def?.tips.length) lines.push("tips:\n" + def.tips.map((t) => ` - ${t}`).join("\n"));
  if (def?.escalate) lines.push(`check with your human before: ${def.escalate}`);
  if (brief) lines.push(`note from the room opener: ${brief}`);
  lines.push("------------------------------------------------------------------------");
  return lines.join("\n");
}

/** A short catalog of predefined kinds for a discovery tool. */
export function listKinds(): string {
  return (
    Object.entries(KINDS)
      .map(([k, d]) => `• ${k} — ${d.summary}\n  roles: ${Object.keys(d.roles).join(", ")}\n  goal: ${d.goal}`)
      .join("\n\n") + "\n\nYou can also use any custom kind label."
  );
}
