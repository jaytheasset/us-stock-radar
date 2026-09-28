const FORM144_RULES = Object.freeze([
  "For Form 144, every current row is a proposed-sale notice, not proof that a sale was executed.",
  "Keep the person for whose account securities are proposed to be sold distinct from the broker, market maker, filing agent, issuer, and any seller named only in past-sale history.",
  "Bind owner attribution to the reporting person or account owner supported by the XML. Do not use a broker or filing agent as the beneficial owner.",
  "Keep the current proposed-sale terms, securities-acquisition history, and securities sold during the past three months as separate scopes. Do not move facts between those sections.",
  "A Rule 10b5-1 plan or instruction applies only to the reporting person and proposal scope established by the source; do not spread it to unrelated acquisition or past-sale rows.",
  "Treat shares or units outstanding as the Form 144 row's comparison disclosure, not as canonical issuer outstanding shares for another consumer.",
  "Use ownership_relation only when the XML or a scoped remark explicitly establishes direct or indirect ownership for the selected owner. Otherwise omit it or return unresolved.",
  "Do not emit economic_direction for a proposed sale; proposed does not mean executed.",
]);

export function buildForm144SemanticRules(): readonly string[] {
  return FORM144_RULES;
}
