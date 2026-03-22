#!/usr/bin/env node

const COS = require('cos-nodejs-sdk-v5');
const { uploadInstallerToTencentCos } = require('./tencent-cos-utils.cjs');

async function main() {
  const filePath = process.argv[2] || 'Axon-Setup.exe';
  const result = await uploadInstallerToTencentCos({
    cosSdk: COS,
    filePath,
  });

  console.log(`Tencent COS upload complete: ${result.publicUrl}`);
  console.log(`Object key: ${result.objectKey}`);
  console.log(`SHA256: ${result.sha256}`);
}

main().catch(error => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
