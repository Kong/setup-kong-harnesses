# setup-kong-harnesses

Install [kong-harnesses](https://github.com/Kong/kong-harnesses) so that it can be used in your GitHub Actions workflows.

Add this step to install the latest release of `kong-harnesses`:

```yaml
- uses: kong/setup-kong-harnesses@v1
```

The action runs on Linux, macOS and Windows runners, on x64 and arm64. It checks the downloaded archive against the `SHA256SUMS.txt` file of the release and stops on a mismatch.

## Sample workflow

```yaml
on:
  push:
    branches:
      - main
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: kong/setup-kong-harnesses@v1
      - run: kong-harnesses --help
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

Publish a GitHub release with a semantic version tag, for example `v1.0.0`. The Publish workflow builds `dist/index.mjs`, pushes it with `action.yml` to that tag and moves the major tag, for example `v1`, to the same commit.
