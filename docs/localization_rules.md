# Localization Rules

Per-language technical rules for translation. Used together with tone_of_voice.md
in translation prompts.

## Universal rules (apply to all languages)

- Always use INFORMAL second-person address (тип "du" не "Sie" у DE).
  Listener is a personal companion, not a stranger or superior.
- Maintain this consistency across the entire translation — never switch
  between formal and informal forms within or between paragraphs.

## Per-language rules

### German (de)
- Address: informal "du" (NEVER "Sie")
- Possessive: "dein" / "deine" (NEVER "Ihr" / "Ihre")
- Compound words: prefer natural German compounds over English-style multi-word phrases

### Spanish (es)
- Variant: Castilian Spanish (Spain), NOT Latin American
- Address: informal "tú" (NEVER "usted")
- Possessive: "tu" / "tus"

### French (fr)
- Address: informal "tu" (NEVER "vous")
- Possessive: "ton" / "ta" / "tes"

### Italian (it)
- Address: informal "tu" (NEVER "Lei" / "voi" formal)
- Possessive: "tuo" / "tua" / "tuoi" / "tue"

### Polish (pl)
- Address: informal "ty" / direct second person verb forms
- Avoid: "Pan" / "Pani" formal address

### Portuguese (pt)
- Variant: European Portuguese (Portugal), NOT Brazilian
- Address: informal "tu" (NOT "você" — that's more BR; in EU PT it's also less personal)
- Note: European Portuguese conjugation differs from Brazilian — ensure proper EU PT verb forms

### Turkish (tr)
- Address: informal "sen" (NEVER "siz" formal)
- Possessive: "senin"

## Notes
- These rules can be extended as we discover more language-specific decisions
- When in doubt, prioritize: warmth > formality, natural flow > literal accuracy
