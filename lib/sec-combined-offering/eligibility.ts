export const FORMS = ['S-1', 'S-1/A', 'S-3', 'S-3/A', '424B3', '424B5'] as const;
export const isCombinedForm = (form: unknown): form is typeof FORMS[number] =>
 typeof form === 'string' && (FORMS as readonly string[]).includes(form);
