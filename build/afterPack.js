// Firma "ad-hoc" (sin certificado de desarrollador) para que la app arranque en Apple Silicon.
const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  try {
    execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'inherit' });
    console.log('  • firma ad-hoc aplicada a', app);
  } catch (e) {
    console.warn('  • no se pudo aplicar la firma ad-hoc:', e.message);
  }
};
