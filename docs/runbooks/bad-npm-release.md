# Runbook — Bad npm Release (`@perssonify/editor`)

Releases are published by `.github/workflows/publish.yml` when a `vX.Y.Z` tag is
pushed: it checks the tag against `package.json`, runs the type check, the unit
tests and the library build, then `npm publish --provenance --access public`
behind the `npm` GitHub environment ([deployment.md ▸ Publishing](../deployment.md#publishing-the-npm-package)).

## Symptoms
- Consumers report a broken install, missing files (`dist/`), a crash on
  import, a missing stylesheet (`@perssonify/editor/styles.css`), or types that
  do not resolve.
- The published tarball differs from what `npm pack --dry-run` showed in the
  workflow log.
- A version appears on npm that no workflow run published (compromised token).

## Diagnosis
```bash
npm view @perssonify/editor versions --json        # what is out there
npm view @perssonify/editor@X.Y.Z dist             # tarball + integrity
npm audit signatures                               # provenance: which workflow + commit built it
npm pack @perssonify/editor@X.Y.Z && tar -tzf perssonify-editor-X.Y.Z.tgz | head   # contents
```
A version **without provenance**, or with provenance pointing somewhere other
than this repository's Publish workflow, was not published by CI — treat it as
a compromise ([security-incident.md](security-incident.md)).

## Remediation
- **Broken but harmless**: publish a fixed patch release (bump `package.json`,
  tag `vX.Y.(Z+1)`), then deprecate the bad one so installs warn:
  `npm deprecate @perssonify/editor@X.Y.Z "Broken — use X.Y.(Z+1)"`.
- **Unpublish** only within npm's policy window (72 hours, and only if nothing
  depends on it): `npm unpublish @perssonify/editor@X.Y.Z`. A version number can
  never be reused, so the fix still needs a new version.
- **Wrong dist-tag** (e.g. a pre-release became `latest`):
  `npm dist-tag add @perssonify/editor@<good> latest`.
- **Compromised token or account**: revoke the token (npm ▸ Access Tokens),
  remove `NPM_TOKEN` from the repository secrets, rotate, check the org's
  members and 2FA, deprecate every version CI did not publish, and move to npm
  *trusted publishing* so no long-lived token exists.

## Prevention
- Only CI publishes. Nobody runs `npm publish` from a laptop.
- The `npm` environment requires a reviewer before the job runs.
- The org requires 2FA; the publish token is scoped to this package.
- `npm pack --dry-run` in the workflow log is the record of what shipped.

## Escalation
The npm org owner(s) and the repository admins.
