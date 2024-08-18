const { composeFullVerkey } = require('indyscan-txtype/src/util')
const { isAbbreviatedVerkey } = require('indyscan-txtype/src/util')

// https://github.com/hyperledger/indy-sdk/blob/315ea1ef63830529b57c20ee45212ad5ce90fd0a/libindy/src/domain/ledger/constants.rs#L37
const ROLE_ACTIONS = {
  0: 'SET_TRUSTEE',
  2: 'SET_STEWARD',
  101: 'SET_ENDORSER',
  201: 'SET_NETWORK_MONITOR'
}

const UNKNOWN_ROLE_ACTION = 'UNKNOWN_ROLE_ACTION'

function roleIdToRoleAction (id) {
  if (id === null || id.trim() === '') {
    return 'REMOVE_ROLE'
  }
  return ROLE_ACTIONS[id.trim()] || UNKNOWN_ROLE_ACTION
}

function tryParseRawData (rawData) {
  let parsed
  let endpoint
  let lastUpdated
  try {
    parsed = JSON.parse(rawData)
    if (parsed.endpoint) {
      if (parsed.endpoint.endpoint) {
        if (parsed.endpoint.endpoint.endpoint) { // fix for bad txn
          endpoint = parsed.endpoint.endpoint.endpoint
        }
        else {
          endpoint = parsed.endpoint.endpoint
        }
      }
      else if (parsed.endpoint.agent) {
        endpoint = parsed.endpoint.agent
      } else if (parsed.endpoint.xdi) {
        endpoint = parsed.endpoint.xdi
      } else if (parsed.endpoint.processor_url) {
        endpoint = parsed.endpoint.processor_url
      } else if (parsed.endpoint.controller_url) {
        endpoint = parsed.endpoint.controller_url
      }
    } else if (parsed.url) {
      endpoint = parsed.url
    }
    if (parsed.last_updated) {
      lastUpdated = parsed.last_updated
    }
  } catch (err) { }
  if (typeof endpoint !== 'string'){
    endpoint = undefined // sanitize input
  }
  return { endpoint, lastUpdated }
}

function getFullVerkey (did, verkey) {
  return (isAbbreviatedVerkey(verkey)) ? composeFullVerkey(did, verkey) : verkey
}

async function transformNymAttrib (tx) {
  if (tx.txn && tx.txn.data) {
    if (tx.txn.data.dest === undefined) {
      if (tx.txn.metadata.from === undefined) {
        throw Error('Found no data.dest and no metadata.from.')
      }
      tx.txn.data.dest = tx.txn.metadata.from
    }
    if (tx.txn.data.verkey !== undefined) {
      tx.txn.data.verkeyFull = getFullVerkey(tx.txn.data.dest, tx.txn.data.verkey)
    }
    if (tx.txn.data.role !== undefined) {
      tx.txn.data.roleAction = roleIdToRoleAction(tx.txn.data.role)
    }
    if (tx.txn.data.raw) {
      const { endpoint, lastUpdated } = tryParseRawData(tx.txn.data.raw)
      if (endpoint !== undefined) {
        tx.txn.data.endpoint = endpoint
      }
      if (lastUpdated !== undefined) {
        tx.txn.data.lastUpdated = lastUpdated
      }
    }
  }
  return tx
}

module.exports.transformNymAttrib = transformNymAttrib
