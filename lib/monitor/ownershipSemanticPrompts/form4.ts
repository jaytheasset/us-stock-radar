const FORM4_RULES = Object.freeze([
  "For Form 4, distinguish a transaction row from a holdings-only row and do not turn a reported holding into a new transaction.",
  "Keep Table I non-derivative securities and Table II derivative securities separate, including their distinct security titles and row identities.",
  "Treat direct or indirect ownership as owner-specific. In a joint filing, use footnotes and nature-of-ownership text to bind the relation to one owner; if the DTO cannot express every owner-specific relation, omit or mark the single relation unresolved.",
  "For a derivative row, link an underlying security only when the XML relationship and a distinct allowed target security ID are both present. Never use the derivative row security as its own underlying target.",
  "Keep paired exercise or conversion rows separate. Link them only when the XML and footnotes establish the same conversion; do not describe the acquisition and disposition legs as an economic purchase or sale.",
  "Interpret footnotes and remarks only at their explicit row, owner, security, or filing scope. A Rule 10b5-1 assertion is row-level; do not spread a plan footnote to unlinked rows.",
  "An explicit filing-level aff10b5One false may support false for its rows unless conflicting row evidence exists. Missing plan evidence is not false, and a true plan statement still requires applicable row evidence.",
  "Read Form 4 transaction codes mechanically: P=open-market/private purchase, S=open-market/private sale, G=gift, M=exercise or conversion of a derivative, F=payment of exercise price or tax liability by delivering/withholding securities, and C=conversion of a derivative. Keep those distinct meanings and do not compress any code or A/D value into economic_direction.",
]);

export function buildForm4SemanticRules(): readonly string[] {
  return FORM4_RULES;
}
