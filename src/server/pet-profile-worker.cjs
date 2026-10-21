const { parentPort, workerData } = require('node:worker_threads');
const { createPetProfiles } = require('./pet-profiles.cjs');
try {
  const service = createPetProfiles({ roots: () => workerData.roots, photoRoots: () => workerData.photoRoots });
  const args = workerData.args;
  if (workerData.method === 'upload') args[2] = Buffer.from(args[2]);
  const value = service[workerData.method](...args);
  parentPort.postMessage({ value });
} catch (error) {
  parentPort.postMessage({ error: { message: error.status ? error.message : 'Pet photo storage could not complete the operation. Retry without changing the operation identity.', status: error.status || 500 } });
}
