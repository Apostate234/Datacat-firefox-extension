# Build Instructions

This document describes how to build and package Pincat for Chrome and Firefox.

## Prerequisites

- Node.js (optional, for build scripts)
- Browser for testing (Chrome, Firefox, or both)

## Building for Chrome

### Development/Testing
1. Open `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the extension directory (root of this repo)
5. Extension will load with the standard `manifest.json`

### Production Build
```bash
# Simply use the current manifest.json
# Package the entire directory (excluding .git, node_modules, etc.)
zip -r pincat-chrome.zip . \
  --exclude ".git/*" \
  --exclude "node_modules/*" \
  --exclude ".gitignore" \
  --exclude "manifest.firefox.json" \
  --exclude "**/.*"
```

## Building for Firefox

### Development/Testing

#### Option 1: Temporary Add-on (Recommended for Development)
1. Open `about:debugging#/runtime/this-firefox` in Firefox
2. Click "Load Temporary Add-on"
3. Navigate to the repo directory
4. Select `manifest.firefox.json` (or any file in the extension directory)
5. Extension will load with `manifest.firefox.json`
6. **Note:** Temporary add-ons are unloaded when Firefox restarts

#### Option 2: Firefox Developer Edition (Persistent)
- Install [Firefox Developer Edition](https://www.mozilla.org/en-US/firefox/developer/)
- Follow the same steps as above
- Can be made persistent by developing it

### Production Build

#### Option A: Use manifest.firefox.json directly
```bash
# Create a build directory with Firefox manifest as manifest.json
mkdir -p build-firefox
cp -r . build-firefox/ \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=manifest.firefox.json \
  --exclude=.gitignore \
  --exclude="*/.*"

# Swap manifests
cp build-firefox/manifest.firefox.json build-firefox/manifest.json
rm build-firefox/manifest.firefox.json

# Remove Chrome-specific files if any exist
rm build-firefox/manifest.chrome.json 2>/dev/null || true

# Package
zip -r pincat-firefox.zip build-firefox \
  --exclude "build-firefox/.git/*" \
  --exclude "build-firefox/node_modules/*"
```

#### Option B: Use a Build Script
Create `scripts/build.js`:
```javascript
const fs = require('fs');
const path = require('path');

const browser = process.argv[2] || 'chrome';
const manifest = require(`../manifest.${browser}.json`);

// Write to dist directory
const distDir = `dist-${browser}`;
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(
  path.join(distDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);

console.log(`✓ Built for ${browser}`);
```

Then run:
```bash
node scripts/build.js firefox
node scripts/build.js chrome
```

## Manifest Selection Strategy

### Current Approach
We maintain two manifests:
- `manifest.json` — Chrome/Default
- `manifest.firefox.json` — Firefox-specific

### Recommended Approach for Development
Use a symbolic link or build tool to swap manifests based on target browser.

## Testing Across Browsers

### Chrome Testing
```bash
# Method 1: Load unpacked (see above)
# Method 2: Use command line
google-chrome --load-extension=/path/to/extension
```

### Firefox Testing
```bash
# Using web-ext (Mozilla's CLI tool)
npm install --save-dev web-ext

# Load temporary add-on
web-ext run --source-dir .

# Or with specific manifest
web-ext run --source-dir . --config web-ext-config.js
```

Create `web-ext-config.js`:
```javascript
module.exports = {
  sourceDir: __dirname,
  artifactsDir: 'dist-firefox',
  ignoreFiles: [
    'manifest.json',  // Ignore Chrome manifest when testing Firefox
    'BUILD_INSTRUCTIONS.md',
  ],
};
```

## Continuous Integration

### GitHub Actions Example

Create `.github/workflows/build.yml`:
```yaml
name: Build Extension

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        browser: [chrome, firefox]
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Build for ${{ matrix.browser }}
        run: node scripts/build.js ${{ matrix.browser }}
      
      - name: Package
        run: |
          cd dist-${{ matrix.browser }}
          zip -r ../pincat-${{ matrix.browser }}.zip .
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: pincat-${{ matrix.browser }}
          path: pincat-${{ matrix.browser }}.zip
```

## Submission

### Chrome Web Store
1. Create a [Chrome Web Store developer account](https://chrome.google.com/webstore/devconsole)
2. Upload `pincat-chrome.zip`
3. Fill in store listing details
4. Submit for review (~1-3 days)

### Firefox Add-ons
1. Create a [Mozilla Developer account](https://addons.mozilla.org/)
2. Upload `pincat-firefox.zip`
3. Fill in listing details
4. Firefox add-ons are reviewed by humans (~5-7 days)
5. Once approved, your add-on is listed on addons.mozilla.org

## Troubleshooting

### Extension doesn't load in Firefox
- Ensure `manifest.firefox.json` is renamed to `manifest.json` or use web-ext
- Check Firefox DevTools console for errors
- Verify Firefox version is 109+ for MV3 support

### Chrome throws "Unknown manifest key"
- Ensure you're using `manifest.json` (not `.firefox.json`)
- Clear browser cache and reload

### Content scripts not injecting
- Check that host_permissions are correct
- Verify the page URL matches a pattern in `content_scripts[].matches`
- Look at browser console for CSP or injection errors

## References

- [web-ext Documentation](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/)
- [Chrome Web Store Publishing](https://developer.chrome.com/docs/webstore/publish/)
- [Firefox Add-ons Submission](https://extensionworkshop.com/documentation/publish/signing-and-distribution-for-firefox-desktop/)
