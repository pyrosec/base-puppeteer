#!/usr/bin/env node
'use strict';

const path = require('path');

const cli = new (require('../lib/base-cli')).PuppeteerCLI({
  programName: 'base-puppeteer',
  logger: require('../lib/logger').createLogger(require('../package').name),
  puppeteerClassPath: path.join(__dirname, '..', 'lib', 'base-puppeteer')
});

(async () => {
  await cli.runCLI();
})().catch((err) => {
  cli.logger.error(err);
  process.exit(1);
});
