## Summary

<!-- What changed and why. One paragraph. If it changes on-chain behaviour, say so first. -->

## Test plan

<!-- How you know this works. Not "tests pass" — which tests, covering which behaviour. -->

- [ ] `npm run verify:all` passes locally (compile + typecheck + lint + format + tests)
- [ ] `npm run slither` reports no new findings
- [ ] New behaviour has a test; new revert paths have a test each
- [ ] If a security property changed, `test/security/` reflects it

## On-chain impact

<!-- Delete if none. -->

- [ ] Storage layout unchanged (or: migration described below)
- [ ] Access control unchanged (or: new roles/permissions listed below)
- [ ] Deployment artefacts in `deployments/` updated
- [ ] `CHANGELOG.md` updated
