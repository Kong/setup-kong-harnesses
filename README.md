# setup-kong-harnesses

Install [kong-harnesses](https://github.com/Kong/kong-harnesses) so that it can be used in your GitHub Actions workflows.

Add this step to install the latest release of `kong-harnesses`:

```yaml
- uses: kong/setup-kong-harnesses@v1
```

The action runs on Linux, macOS and Windows runners, on x64 and arm64. It checks the downloaded archive against the `SHA256SUMS.txt` file of the release and stops on a mismatch.

On Linux, kong-harnesses keeps its profile lock in `XDG_RUNTIME_DIR`, which a hosted runner does not set. When the variable is unset, the action creates a private directory in the runner's temporary directory and sets `XDG_RUNTIME_DIR` to it for the later steps of the job.

## Sample workflow

A CI job has no person to sign in, so it uses a key that the Kong AI Gateway administrator issues. Commit a profile with `"sign_in": "environment_key"`, and keep the key in a repository secret. kong-harnesses reads the key from `KONG_HARNESSES_STATIC_KEY` each time Claude Code asks for a credential, so set the variable on the step that runs Claude Code. The kong-harnesses [operations guide](https://github.com/Kong/kong-harnesses/blob/main/docs/operations.md#environment-key-for-ci) describes the profile and the gateway setup.

```yaml
on:
  pull_request:
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: kong/setup-kong-harnesses@v1
      - run: npm install --global @anthropic-ai/claude-code
      - run: kong-harnesses profile import --auto-approve .github/kong-ci-profile.json
      - run: kong-harnesses profile activate ci --client claude-code --auto-approve
      - run: claude -p "Review the change in this pull request"
        env:
          KONG_HARNESSES_STATIC_KEY: ${{ secrets.KONG_AI_GATEWAY_KEY }}
```

To install a specific version, set the `kong-harnesses-version` input:

```yaml
- uses: kong/setup-kong-harnesses@v1
  with:
    kong-harnesses-version: 0.13.0
```

## Inputs

| Name | Description | Default |
| --- | --- | --- |
| `kong-harnesses-version` | The version to install, for example `0.13.0`. | The latest release |
| `token` | A github.com token that reads the kong-harnesses releases. On GitHub Enterprise Server, set it to an empty string or a github.com token. | `${{ github.token }}` |

## Outputs

| Name | Description |
| --- | --- |
| `version` | The version that the action installed, for example `0.13.0`. |

## Release

Publish a GitHub release with a semantic version tag, for example `v1.0.0`. The Publish workflow builds `dist/index.mjs`, pushes it with `action.yml` to that tag and moves the major and minor tags, for example `v1` and `v1.0`, to the same commit.

These tags go to the release of the last Publish run, also when that release is older. Thus publish only a release that is newer than all others with the same major version, publish it as a full release and not as a prerelease that you promote later, and re-run only the Publish run of the newest release.
