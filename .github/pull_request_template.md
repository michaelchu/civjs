## Summary

Describe the user-visible behavior and implementation scope.

## Port evidence (required for game behavior or client-parity changes)

- [ ] Not a porting change; this change does not alter game behavior, ruleset data, or client/server protocol.
- [ ] Source reference recorded: `reference/freeciv/...` or `reference/freeciv-web/...`, including file and line range.
- [ ] Packet impact assessed: existing contract row updated, or no packet impact explained below.
- [ ] Ruleset impact assessed: inventory/status updated, or no ruleset impact explained below.

Source reference and rationale:

<!-- Include the source path, line range, and any intentional CivJS-specific deviation. -->

Packet/ruleset impact:

<!-- Link the relevant PORTING_INVENTORY row or explain why none applies. -->

## Verification

- [ ] `npm run format:check`
- [ ] `npm run lint`
- [ ] `npm run test:unit`
- [ ] `npm run typecheck`
- [ ] Relevant integration or manual test, if applicable
