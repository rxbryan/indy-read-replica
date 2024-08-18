const { envConfig } = require('./config/env')
const logger = require('./logging/logger-main')
const _ = require('lodash')
const sleep = require('sleep-promise')
const util = require('util')
const { startServer } = require('./server/server')
const { createServiceWorkers } = require('./service/service-workers')
const Mustache = require('mustache')
const { getWorkerConfigPaths } = require('./config/env')
const fs = require('fs')
const path = require('path')
const { createNetOpRtwExpansion } = require('./worker-templates/rtw-db-expansion')
const { createNetOpRtwSerialization } = require('./worker-templates/rtw-ledger-to-serialized')
// TODO: Setting up IndySKD logging here is causing seemmingly random crashes!
// const indy = require('indy-sdk')
// indy.setLogger(function (level, target, message, modulePath, file, line) {
//   if (level === 1) {
//     logger.error(`INDYSDK: ${message}`)
//   } else if (level === 2) {
//     logger.warn(`INDYSDK: ${message}`)
//   } else if (level === 3) {
//     logger.info(`INDYSDK: ${message}`)
//   } else if (level === 4) {
//     logger.debug(`INDYSDK: ${message}`)
//   } else {
//     logger.silly(`INDYSDK: ${message}`)
//   }
// })

async function buildWorker (builder, builderParams) {
  logger.info(`Going to build worker by ${builder} from ${JSON.stringify(builderParams, null, 2)}`)
  if (builder === 'rtwSerialization') {
    return createNetOpRtwSerialization(builderParams)
  } else if (builder === 'rtwExpansion') {
    return createNetOpRtwExpansion(builderParams)
  } else {
    throw Error(`Unknown builder type ${builder}`)
  }
}

async function run () {
  const serviceWorkers = createServiceWorkers()
  let allWorkers = []
  let allSources = []
  let allTargets = []
  let allTransformer = []
  let allIterators = []
  try {
    const workerConfigPaths = getWorkerConfigPaths()
    await sleep(2000)
    logger.info(`Will bootstrap app from following operations definitions ${JSON.stringify(workerConfigPaths, null, 2)}`)

    for (const workerConfigPath of workerConfigPaths) { // per each worker config file, render the file
      const workersConfig = fs.readFileSync(workerConfigPath)
      const { workersBuildersTemplate, env } = JSON.parse(workersConfig)
      env.cfgdir = path.dirname(workerConfigPath)
      const workerBuilders = JSON.parse(Mustache.render(JSON.stringify(workersBuildersTemplate), env)) // render template
      for (const workerBuilder of workerBuilders) { // one file can define multiple workers
        const { builder, params } = workerBuilder
        const { workers, sources, targets, transformers, iterators } = await buildWorker(builder, params)
        allWorkers.push(workers)
        allSources.push(sources)
        allTargets.push(targets)
        allTransformer.push(transformers)
        allIterators.push(iterators)
      }
    }
  } catch (e) {
    console.error(util.inspect(e))
    return
  }
  allWorkers = _.flatten(allWorkers)
  allSources = _.flatten(allSources) // eslint-disable-line
  allTargets = _.flatten(allTargets) // eslint-disable-line
  allTransformer = _.flatten(allTransformer) // eslint-disable-line
  allIterators = _.flatten(allIterators) // eslint-disable-line
  logger.info(`Built all workers. Workers total ${allWorkers.length}`)
  for (const worker of allWorkers) {
    serviceWorkers.registerWorker(worker)
  }

  if (envConfig.AUTOSTART) {
    logger.info('Autostarting all workers.')
    const workers = serviceWorkers.getWorkers()
    for (const worker of workers) {
      worker.enable()
    }
  } else {
    logger.info('Worker autostart is disabled.')
  }
  if (envConfig.SERVER_ENABLED) {
    startServer(serviceWorkers)
  }
}

// process.on('error', (err) => {
//   console.log(`Error event ${JSON.stringify(err)}`)
//   process.exit(1);
// });
//
// process.on('uncaughtException', (err) => {
//   console.log(`Error event ${JSON.stringify(err)}`)
//   process.exit(1);
// });
//
// process.on('unhandledRejection', (reason, promise) => {
//   throw reason;
// })

run()
