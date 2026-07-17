import { createServer } from 'vite';
import fs from 'fs';

async function run() {
  try {
    const server = await createServer({
      configFile: './vite.config.js'
    });
    await server.listen();
    console.log('Server listening on port', server.config.server.port);
    process.exit(0);
  } catch (err) {
    fs.writeFileSync('error.txt', (err.stack || err.message || err.toString()).replace(/\r\n/g, '\n'));
    process.exit(1);
  }
}

run();
