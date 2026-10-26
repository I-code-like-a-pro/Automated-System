'use strict';
/* Loaded before every test file (node --import). Tests must never reach a real AI service, so any keys left in the
   machine's environment are removed. Individual tests set a fake key themselves when they need the AI paths. */
for (const k of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'AI_PROVIDER', 'AI_MODEL', 'AI_GEN_MODEL', 'ANTHROPIC_MODEL', 'ANTHROPIC_GEN_MODEL']) delete process.env[k];
