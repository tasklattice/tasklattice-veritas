/** Stable product labels for upstream promptfoo template families. No template text is copied here. */
export const ATTACK_TEMPLATE_LABELS = {
  'educational-context':'Educational pretext',
  'dan-mode':'DAN mode',
  'developer-mode':'Developer mode',
  'aim':'AIM / Machiavelli roleplay',
  'fictional-guide':'Fictional unrestricted guide',
  'opposite-persona':'Opposite persona',
} as const;
export type AttackTemplateId=keyof typeof ATTACK_TEMPLATE_LABELS;
export const ATTACK_TEMPLATE_IDS=Object.keys(ATTACK_TEMPLATE_LABELS) as AttackTemplateId[];
