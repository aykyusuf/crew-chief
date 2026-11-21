# Model switches

When switching the session's model asks first, and what the new model is told.

[← README](../../README.md) · [Türkçe](../rehber/model-switches.md)

Switching the session's model (`/model`, the picker) asks first only when it costs something real: leaving Fable (other models cannot read Fable's thinking, so the reasoning behind the work is lost), or a warm prompt cache whose re-write on the new model would cost about 1 USD or more (the question names the tokens and the price and suggests updating the handoff files or `/compact` first). After a switch the new model gets one note: restate the plan after leaving Fable, keep the context lean on a more expensive model. `CREW_CHIEF_MODEL_SWITCH=off` turns it off. Compactions already get crew-chief's brief through the mod, so there is no separate PreCompact hook.
