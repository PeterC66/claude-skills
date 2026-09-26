/*
 * outbound_letter.mjs — what an unsent letter is worth on the board, and the
 * one declaration that may move it (buses-data CORR-004, 2026-09-17).
 *
 * A DRAFTED LETTER THAT ANSWERS NOBODY'S QUESTION IS NOT A DEBT, and until this
 * module existed there was no way to say so. Rank 3 is deliberately immune to
 * prose — no wording in a record WE write takes a letter off that band —
 * because the thing it protects is a person waiting, and a session that could
 * argue one debt away would eventually argue away a real one. That rule is
 * unchanged and is still right.
 *
 * CORR-004 is the case the immunity was hiding. He never wrote to us: he gave
 * his views to a fellow campaigner who asked for them, three weeks after an
 * hour's demonstration, and that thread's own README has said since the day it
 * was written that nobody has asked him whether he wants a reply. The row sat
 * in SOMEONE IS BLOCKED for ten days under "the person has heard nothing",
 * which was TRUE and was not an obligation. The prose beside it said so and
 * nothing joined the two. The gap was that the immunity had no legitimate
 * RELEASE — the only exits were to send a letter nobody wanted or to nag for
 * ever — and a guard with no release is one somebody eventually routes around.
 *
 * So a hold is a DECLARATION, with the two halves that make it one: who decided
 * and when, and WHAT WOULD CHANGE IT. The second is the load-bearing one — a
 * hold with no route back is how a letter rots quietly, which is the failure
 * this whole source exists to prevent — so a `**Held:**` with no
 * `**Revisit when:**` STAYS AT RANK 3 and says why. An incomplete hold nags,
 * the same failure direction every other branch in this source takes.
 *
 * And it DEMOTES rather than silencing: rank 9, WAITING ON OTHERS, which is
 * what a letter waiting on a condition outside this project actually is. A
 * suppression nobody can see is how a board starts lying, and the thing being
 * held is a letter to a real person.
 *
 * Falsified in `prove-red-correspondence.mjs`, which drives worklist.mjs
 * end-to-end rather than calling this directly — the assertions are about the
 * board, so they survived this logic being moved out of it.
 */

/** The hold as declared in an outbound message's header, or empty strings. */
export function readHold(head) {
  const held = /\*\*Held:\*\*\s*([^\n]+)/.exec(head);
  const revisit = /\*\*Revisit when:\*\*\s*([^\n]+)/.exec(head);
  return { heldWhy: held ? held[1].trim() : '', revisitWhy: revisit ? revisit[1].trim() : '' };
}

/**
 * The row for an outbound message that declares itself unsent: held at rank 9
 * when the declaration is complete, and the ordinary rank 3 otherwise.
 *
 * Called ONLY from inside the unsent branch, which is the reason a leftover
 * hold on a letter that has GONE raises nothing at all. A version consulting
 * the hold first would report a sent letter as held for ever.
 */
export function unsentLetterItem({ ref, label, head, date, file, buses, ageDays }) {
  const { heldWhy, revisitWhy } = readHold(head);
  if (heldWhy && revisitWhy) {
    return {
      key: `corr-held-${ref}`, rank: 9, type: 'correspondence',
      title: `${label}: reply drafted ${date}, HELD — deliberately not being sent`,
      why: `${heldWhy} Revisit when: ${revisitWhy} Nobody is waiting on this one — it is here so that a held letter cannot rot unnoticed, not because anything is owed.`,
      who: 'Peter', runbook: 'correspondence',
      ageDays,
      do: [
        { kind: 'chat', what: `Read Correspondence/${ref}/${file} — the hold and what would lift it are declared in its header.` },
        { kind: 'chat', what: 'To lift it: delete both the **Held:** and **Revisit when:** lines, and the row returns to SOMEONE IS BLOCKED where only you can clear it.' },
      ],
    };
  }
  return {
    key: `corr-unsent-${ref}`, rank: 3, type: 'correspondence',
    title: `${label}: reply drafted ${date}, NOT SENT`,
    why: heldWhy
      ? `It declares a hold — "${heldWhy}" — but no **Revisit when:**, so it is still on this list. A hold with no condition that lifts it is how a letter is quietly abandoned; write what would change it, or send it.`
      : 'Only you can send it — there is no reply button on the portal and Claude has no access to email. Until it goes, the person has heard nothing.',
    who: 'Peter', runbook: 'correspondence',
    ageDays,
    do: [
      // The send page and file-sent.mjs replaced "open the .html, Ctrl+A, add
      // the salutation yourself" on 2026-09-26 (buses-data OA-469): the name is
      // filled in, and the record is read from the email that actually went.
      { kind: 'shell', cwd: buses, cmd: `node Correspondence/send-page.mjs "Correspondence/${ref}/${file}"`, note: 'or ask Claude for the send page' },
      { kind: 'chat', what: 'On the page: Open a new message, Copy the letter, paste it, drag in the files, change anything you like, and send.' },
      { kind: 'chat', what: 'In Zoho, open it in Sent, then More Actions > Save as > EML, and tell Claude "sent": it files what went with file-sent.mjs.' },
    ],
  };
}
