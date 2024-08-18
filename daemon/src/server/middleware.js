const uuid = require('uuid')
const logger = require('../logging/logger-main')

function logResponses (req, res, next) {
  var oldWrite = res.write

  var oldEnd = res.end

  var chunks = []

  res.write = function (chunk) {
    chunks.push(chunk)
    oldWrite.apply(res, arguments)
  }

  res.end = function (chunk) {
    if (!req.path.includes(['/favicon']) && !req.path.includes(['swagger-ui'])) {
      if (chunk && Buffer.isBuffer(chunk)) {
        chunks.push(chunk)
        var body = Buffer.concat(chunks).toString('utf8')
        logger.info(`HTTP Response [${req.method}] ${req.path} Response code: ${res.statusCode} Response body: ${body}`)
      }
    }
    oldEnd.apply(res, arguments)
  }
  next()
}

function logRequests (req, res, next) {
  logger.info(`HTTP Request: [${req.method}] ${req.originalUrl} Request body: ${JSON.stringify(req.body)}`)
  next()
}

const asyncHandler = fn => (req, res, next) => {
  const result = Promise
    .resolve(fn(req, res, next))
    .catch(function (err) {
      const errorId = uuid.v4()
      logger.error(`ErrorID: '${errorId}'. Unhandled error from async express handler. Error details:`)
      logger.error(err.stack)
      res.status(500).send({ message: 'Something went wrong unexpectedly.', errorId })
    })
  return result
}

module.exports.asyncHandler = asyncHandler
module.exports.logRequests = logRequests
module.exports.logResponses = logResponses
