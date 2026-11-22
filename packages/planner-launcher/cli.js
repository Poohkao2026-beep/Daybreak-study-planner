#!/usr/bin/env node
import {spawnSync} from 'node:child_process';

const url = 'https://daybreak-study-planner.vercel.app/planner';
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(url);
} else if (args.length === 1 && args[0] === '--open') {
  const launch = process.platform === 'win32' ? ['rundll32.exe', 'url.dll,FileProtocolHandler'] :
    process.platform === 'darwin' ? ['open'] : ['xdg-open'];
  const result = spawnSync(launch[0], [...launch.slice(1), url], {stdio: 'ignore'});
  if (result.status !== 0) {
    console.error('Open this address in your browser:', url);
    process.exitCode = 1;
  }
} else {
  console.log('daybreak-planner prints the Planner URL. Use --open to open it in your browser.');
  if (args.length !== 1 || args[0] !== '--help') process.exitCode = 2;
}
