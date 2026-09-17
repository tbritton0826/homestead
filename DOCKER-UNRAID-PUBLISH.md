# Docker and Unraid publication checklist

Release: **0.6.8.64**
Image: **ghcr.io/tbritton0826/homestead**

## 1. Publish the container image

1. Create or use the GitHub source repository
   `tbritton0826/homestead`.
2. Push the Homestead source, including
   `.github/workflows/docker-publish.yml`, to its `main` branch.
3. Open the repository's **Actions** tab and run
   **Publish Homestead Docker image** if the push did not start it.
4. Open the resulting `homestead` package and change its visibility to
   **Public**.
5. Confirm both pulls work without signing in:

   ```sh
   docker pull ghcr.io/tbritton0826/homestead:0.6.8.64
   docker pull ghcr.io/tbritton0826/homestead:latest
   ```

The workflow currently publishes Linux AMD64, matching normal Unraid servers.

## 2. Publish the Community Apps metadata

1. Create a separate **public** GitHub repository named
   `tbritton0826/homestead-community-apps`.
2. Copy the contents of `community-apps-repository` to that repository root.
   Do not copy the containing folder itself.
3. Push to `main` and verify these URLs open without signing in:
   - `https://raw.githubusercontent.com/tbritton0826/homestead-community-apps/main/ca_profile.xml`
   - `https://raw.githubusercontent.com/tbritton0826/homestead-community-apps/main/templates/homestead.xml`
   - `https://raw.githubusercontent.com/tbritton0826/homestead-community-apps/main/icon.svg`
4. Go to `https://ca.unraid.net/submit`, submit the public repository URL, and
   run **Validate** followed by **Scan**.
5. Install the resulting listing on a test Unraid server and confirm setup,
   media paths, persistence after restart, update detection, and WebUI launch.

The MIT license inside `community-apps-repository` covers only the listing
metadata. It does not change the Homestead application's licensing.
