# Releasing

Quireloop is published to PyPI as `quireloop`, so anyone can install it with
`pip install quireloop`. The package holds the built web app, the server and
its modules; Node.js comes with it through the `nodejs-wheel-binaries`
package. LaTeX is still installed separately.

## One-time setup

1. **PyPI account.** Create one at [pypi.org](https://pypi.org/account/register/)
   and turn on two-factor sign-in.
2. **Trusted publisher.** On PyPI, open *Your projects → Publishing → Add a new
   pending publisher* and enter:

   | Field | Value |
   |---|---|
   | PyPI project name | `quireloop` |
   | Owner | the GitHub account or organisation that holds the repository |
   | Repository | `quireloop` |
   | Workflow | `publish-pypi.yml` |
   | Environment | `pypi` |

   This lets the GitHub workflow publish without any password or token.
3. **GitHub environment.** In the repository, open *Settings → Environments*,
   create one named `pypi`, and add yourself as a required reviewer, so no
   release goes out without your approval.

If the repository moves to an organisation, change the owner in step 2.

## Each release

1. Set the same version in `server/package.json` and
   `packaging/pypi/src/quireloop/__init__.py`. The build refuses a mismatch.
2. Try the package locally:

   ```bash
   bash scripts/build-pypi.sh
   python3 -m venv /tmp/ql && /tmp/ql/bin/pip install packaging/pypi/dist/*.whl
   /tmp/ql/bin/quireloop doctor
   /tmp/ql/bin/quireloop start
   ```

3. Commit and push, then push a tag that is the version with a `v`:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

   The *Release* workflow builds the package, waits for your approval, uploads
   it to PyPI, and then creates the GitHub release with the package attached.
   Watch it under the repository's *Actions* tab.

A version number can be uploaded to PyPI only once. A mistake needs a new
version, not a re-upload.
