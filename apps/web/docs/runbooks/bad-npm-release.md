# Runbook — Bad npm Release (`@perssonify/editor`)

Releases are published by hand by an owner, from the commit tagged `vX.Y.Z`:
the verify gate, the library build and its built-package checks,
`npm pack --dry-run`, then `npm publish --access public` from `apps/web`
([deployment.md ▸ Publishing](../deployment.md#publishing-the-npm-package)).

Nothing can be published until an owner claims the `@perssonify` scope on npm
and turns on 2FA for it (A006). Until then, any version that appears under that
name was not published by this project.

## Symptoms
- Consumers report a broken install, missing files (`dist/`), a crash on
  import, a missing stylesheet (`@perssonify/editor/styles.css`), or types that
  do not resolve. (Every formula rendering twice, unstyled, is not a bad
  release: the consumer has not imported `katex/dist/katex.min.css`, which the
  library does not bundle — see the README's Install section.)
- The published tarball differs from what `npm pack --dry-run` showed before
  publishing.
- A version appears on npm that no owner published (compromised account or token).

## Diagnosis
```bash
npm view @perssonify/editor versions --json        # what is out there
npm view @perssonify/editor@X.Y.Z dist             # tarball + integrity
npm pack @perssonify/editor@X.Y.Z && tar -tzf perssonify-editor-X.Y.Z.tgz | head   # contents
```
A version that no owner published was not published by this project — treat it
as a compromise ([security-incident.md](security-incident.md)).

## Remediation
- **Broken but harmless**: publish a fixed patch release (bump `package.json`,
  tag `vX.Y.(Z+1)`), then deprecate the bad one so installs warn:
  `npm deprecate @perssonify/editor@X.Y.Z "Broken — use X.Y.(Z+1)"`.
- **Unpublish** only within npm's policy window (72 hours, and only if nothing
  depends on it): `npm unpublish @perssonify/editor@X.Y.Z`. A version number can
  never be reused, so the fix still needs a new version.
- **Wrong dist-tag** (e.g. a pre-release became `latest`):
  `npm dist-tag add @perssonify/editor@<good> latest`.
- **Compromised token or account**: revoke any token (npm ▸ Access Tokens),
  rotate the owner's credentials, check the org's members and 2FA, and
  deprecate every version no owner published.

## Prevention
- Only an owner publishes, by hand, after the verify gate passes on the tagged
  commit.
- Owner setup: the org requires 2FA; no publish token is stored in the
  repository.
- `npm pack --dry-run` before every publish shows exactly what will ship.

## Escalation
The npm org owner(s) and the repository admins.
