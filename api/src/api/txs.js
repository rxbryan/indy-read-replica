const { json } = require('body-parser')
const { asyncHandler } = require('../middleware')
const { ValidationError } = require('../error')
const { validate } = require('express-validation')
const Joi = require('joi')
const { result } = require('lodash')
const { data } = require('../logging/logger-main')
const { type } = require('os')
const { stringify } = require('querystring')

function initTxsApi (app, networkManager, serviceTxs) {
  function getNetworkId (req, res) {
    const { networkRef } = req.params
    try {
      return networkManager.getNetworkConfig(networkRef).id
    } catch (err) {
      return res.status(404).send({ message: `Couldn't resolve network you are referencing (${networkRef})` })
    }
  }

  function getSubledger(ledgerId) {
    return ['pool', 'domain', 'config'][ledgerId]
  }

  function buildResponse(type, identifier, reqId, txn, txnMetadata, reqSignature, rootHash, auditPath) {
    txn.metadata['reqId'] = reqId
    return {
      op: "REPLY",
      result: {
        type,
        identifier,
        reqId,
        seqNo: txnMetadata.seqNo,
        data: {
          ver: txn.data.ver || 1,
          txn,
          txnMetadata,
          reqSignature,
          rootHash,
          auditPath
        }
      }
    }
  }

  app.get('/api/networks/:networkRef/ledgers/:ledger/txs',
    validate(
      {
        query: Joi.object({
          fromRecentTx: Joi.number(),
          toRecentTx: Joi.number(),
          filterTxNames: Joi.array().items(Joi.string()),
          seqNoGte: Joi.number(),
          seqNoLt: Joi.number(),
          search: Joi.string(),
          format: Joi.string().valid('serialized', 'full', 'expansion')
        })
      }
    ),
    asyncHandler(async function (req, res) {
      const networkId = getNetworkId(req, res)
      const { ledger } = req.params
      console.log(JSON.stringify(req.query))
      const { skip, size, filterTxNames, search, format, sortFromRecent, seqNoGte, seqNoLt } = req.query
      const txs = await serviceTxs.getTxs(
        networkId,
        ledger,
        skip || 0,
        size || 50,
        filterTxNames,
        seqNoGte,
        seqNoLt,
        search,
        format,
        (sortFromRecent === undefined || sortFromRecent === null) ? true : (sortFromRecent === 'true')
      )
      res.status(200).send(txs)
    }))

  // GET_TXN
  app.get('/api/networks/:networkRef/txs/seqno/:seqNo',
    validate(
      {
        query: Joi.object({
          ledgerId: Joi.number().valid(0, 1, 2).required(),
          reqId: Joi.string().required(),
          identifier: Joi.string().required()
        })
      }
    ),
    asyncHandler(async function (req, res) {
      Joi.object({
        seqNo: Joi.number().min(1).required()
      }).validate(req.params, (err, ok) => { if (err) throw err })

      const { seqNo } = req.params
      const { ledgerId,  reqId, identifier } = req.query

      const subledger = getSubledger(ledgerId)
      const networkId = getNetworkId(req, res)
      
      const tx = await serviceTxs.getTx(networkId, subledger, parseInt(seqNo))
      const originalTx = JSON.parse(tx.idata.json)
      console.log(JSON.stringify(originalTx, null, 2))

      res.status(200).send(
        buildResponse(
          "3",
          identifier,
          reqId,
          originalTx.txn,
          originalTx.txnMetadata,
          originalTx.reqSignature,
          originalTx.rootHash,
          originalTx.auditPath
        )
      )
    }))

  // GET_NYM
  app.get('/api/networks/:networkRef/txs/nym/:dest',
  validate(
    {
      query: Joi.object({
        timestamp: Joi.number(),
        seqNo: Joi.number().min(1),
        reqId: Joi.string().required(),
        identifier: Joi.string().required()
      })
    }
  ),
  asyncHandler(async function (req, res, next) {
    const networkId = getNetworkId(req, res)
    const { dest } = req.params
    const { timestamp, seqNo, reqId, identifier } = req.query

    if (timestamp && seqNo) {
      next(new ValidationError("'timestamp' is mutually exclusive with 'seqNo'"))
    }
    else {
      const txs = await serviceTxs.getTxByType(networkId, 'domain', {nym: dest, seqNo, timestamp}, "NYM")
      res.status(200).send(txs.map(tx => {
        let originalTx = JSON.parse(tx.idata.serialized.idata.json)
        originalTx.txn.data.identifier = identifier
        originalTx.txn.data.txnTime = originalTx.txnMetadata.txnTime
        originalTx.txn.data.seqNo = tx.imeta.seqNo

        return {
          op: "REPLY",
          result: {
            type: "105",
            identifier,
            reqId,
            seqNo: tx.imeta.seqNo,
            txnTime: originalTx.txnMetadata.txnTime,
            state_proof: {}
          },
          data: originalTx.txn.data,
          dest: originalTx.txn.data.dest,
        }
      }))
    }

  }))

  // GET_ATTRIB
  app.get('/api/networks/:networkRef/txs/attrib/:dest',
  validate(
    {
      query: Joi.object({
        timestamp: Joi.number(),
        seqNo: Joi.number().min(1),
        raw: Joi.string(),
        reqId: Joi.string().required(),
        identifier: Joi.string().required()
      })
    }
  ),
  asyncHandler(async function (req, res, next) {
    const networkId = getNetworkId(req, res)
    const { dest: nym } = req.params
    const { timestamp, seqNo, raw: rawBase64,  reqId, identifier } = req.query

    if (timestamp && seqNo) {
      next(new ValidationError("'timestamp' is mutually exclusive with 'seqNo'"))
    }
    else {
      const raw = rawBase64 && Buffer.from(rawBase64, 'base64').toString()
      const txs = await serviceTxs.getTxByType(networkId, 'domain', {nym, timestamp, seqNo, raw: raw}, "ATTRIB")
      res.status(200).send(txs.map(tx => {
          let originalTx = JSON.parse(tx.idata.serialized.idata.json)

          return {
            op: "REPLY",
            result: {
              type: "104",
              identifier,
              reqId,
              seqNo: tx.imeta.seqNo,
              txnTime: originalTx.txnMetadata.txnTime,
              state_proof: {}
            },
            data: originalTx.txn.data.raw,
            dest: originalTx.txn.data.dest,
            raw: Object.keys(JSON.parse(originalTx.txn.data.raw))[0]
          }
        }
      ))
    }

  }))

  //GET_SCHEMA
  app.get('/api/networks/:networkRef/txs/schema/:from',
    validate(
      {
        query: Joi.object({
          name: Joi.string().required(),
          version: Joi.string().required(),
          reqId: Joi.string().required(),
          identifier: Joi.string().required()
        })
      }
    ),
    asyncHandler(async function (req, res) {
      const networkId = getNetworkId(req, res)
      const { from } = req.params
      const { version, name,  reqId, identifier } = req.query

      const data = {version, name}
      const tx = await serviceTxs.getTxByType(networkId, 'domain', {from, data}, "SCHEMA")

      let originalTx = JSON.parse(tx.idata.serialized.idata.json)

      const result = {
        op: "REPLY",
        result: {
          data: tx.idata.expansion.idata.txn.data.data,
          type: "107",
          identifier,
          reqId,
          seqNo: tx.imeta.seqNo,
          txnTime: originalTx.txnMetadata.txnTime,
          state_proof: {}
        },
        dest: from
      }

      res.status(200).send(result)

  }))

  //GET_CLAIM_DEF
  app.get('/api/networks/:networkRef/txs/claim-def/:from',
    validate(
      {
        query: Joi.object({
          ref: Joi.string().required(),
          signature_type: Joi.string().valid("CL").required(),
          tag: Joi.string().required(),
          reqId: Joi.string().required(),
          identifier: Joi.string().required()
        })
      }
    ),
    asyncHandler(async function (req, res) {
      const networkId = getNetworkId(req, res)
      const { from } = req.params
      const {
        ref,
        signature_type,
        tag,
        reqId,
        identifier
      } = req.query

      const tx = await serviceTxs.getTxByType(networkId, 'domain', { from, ref, signature_type }, "CLAIM_DEF")

      let originalTx = JSON.parse(tx.idata.serialized.idata.json)

      const result = tag !==  originalTx.txn.data.tag ? {} : {
        op: "REPLY",
        result: {
          data: originalTx.txn.data.data,
          type: "108",
          identifier,
          reqId,
          seqNo: tx.imeta.seqNo,
          txnTime: originalTx.txnMetadata.txnTime,
          state_proof: {}
        },
        signature_type,
        origin: from,
        ref,
        tag
      }

      console.log(JSON.stringify(result, null, 2))
      res.status(200).send(result)

  }))

  //GET_REVOC REG_DEF
  app.get('/api/networks/:networkRef/txs/revoc-reg-def/:id',
    validate(
      {
        query: Joi.object({
          reqId: Joi.string().required(),
          identifier: Joi.string().required()
        })
      }
    ),
    asyncHandler(async function (req, res) {
      const networkId = getNetworkId(req, res)
      const { id } = req.params
      const { reqId, identifier } = req.query

      const tx = await serviceTxs.getTxByType(networkId, 'domain', { id }, "REVOC_REG_DEF")

      let originalTx = JSON.parse(tx.idata.serialized.idata.json)

      const result = {
        op: "REPLY",
        result: {
          type: "115",
          identifier,
          reqId,
          seqNo: tx.imeta.seqNo,
          txnTime: originalTx.txnMetadata.txnTime,
          data: originalTx.txn.data,
          state_proof: {}
        },
      }

      res.status(200).send(result)

  }))

  //GET_REVOC REG_DEF
  app.get('/api/networks/:networkRef/txs/revoc-reg/:revocRegDefId',
    validate(
      {
        query: Joi.object({
          timestamp: Joi.number().required(),
          reqId: Joi.string().required(),
          identifier: Joi.string().required()
        })
      }
    ),
    asyncHandler(async function (req, res) {
      const networkId = getNetworkId(req, res)
      const { revocRegDefId } = req.params
      const { timestamp, reqId, identifier } = req.query

      const tx = await serviceTxs.getTxByType(networkId, 'domain', { revocRegDefId, timestamp }, "REVOC_REG_ENTRY")

      let originalTx = JSON.parse(tx.idata.serialized.idata.json)
      originalTx.txn.data.id = revocRegDefId
      const result = {
        op: "REPLY",
        result: {
          type: "116",
          identifier,
          reqId,
          revocRegDefId,
          seqNo: tx.imeta.seqNo,
          txnTime: originalTx.txnMetadata.txnTime,
          data: originalTx.txn.data,
          state_proof: {}
        },
      }

      res.status(200).send(result)

  }))

  function getDelta(to, from = null ) {
    if (!from) {
      return {issued: to.issued, revoked: to.revoked}
    }

    const issued = to.issued.filter(x => !from.issued.includes(x))
    const revoked = from.issued.filter(x => !to.issued.includes(x))

    return {issued, revoked}
  }

  //GET_REVOC REG_DELTA
  app.get('/api/networks/:networkRef/txs/revoc-reg-delta/:revocRegDefId',
    validate(
      {
        query: Joi.object({
          from: Joi.number(),
          to: Joi.number().required(),
          reqId: Joi.string().required(),
          identifier: Joi.string().required()
        })
      }
    ),
    asyncHandler(async function (req, res) {
      const networkId = getNetworkId(req, res)
      const { revocRegDefId } = req.params
      const { from, to, reqId, identifier } = req.query

      const entry_to = await serviceTxs.getTxByType(networkId, 'domain', { revocRegDefId, timestamp: to }, "REVOC_REG_ENTRY")
      const entry_from = from && (await serviceTxs.getTxByType(networkId, 'domain', { revocRegDefId, timestamp: from }, "REVOC_REG_ENTRY"))

      const {issued, revoked} = getDelta({
        revoked: entry_to.idata.expansion.idata.txn.data.value.revoked || [],
        issued: entry_to.idata.expansion.idata.txn.data.value.issued || []
      }, entry_from && {
        revoked: entry_from.idata.expansion.idata.txn.data.value.revoked || [],
        issued: entry_from.idata.expansion.idata.txn.data.value.issued || []
      })


      let entry_to_originalTx = JSON.parse(entry_to.idata.serialized.idata.json)
      let entry_from_originalTx = entry_from && JSON.parse(entry_from.idata.serialized.idata.json)

      const value = {
        accum_to: {
          "revocDefType": entry_to.idata.expansion.idata.txn.data.revocDefType, 
          "revocRegDefId": entry_to.idata.expansion.idata.txn.data.revocRegDefId, 
          "txnTime": entry_to_originalTx.txnMetadata.txnTime,
          "seqNo": entry_to.imeta.seqNo,
          "value": {
            "accum": entry_to.idata.expansion.idata.txn.data.value.accum
          }
        },
        revoked,
        issued,
        accum_from: entry_from_originalTx && {
          "revocDefType": entry_from.idata.expansion.idata.txn.data.revocDefType, 
          "revocRegDefId": entry_from.idata.expansion.idata.txn.data.revocRegDefId, 
          "txnTime": entry_from_originalTx.txnMetadata.txnTime,
          "seqNo": entry_from.imeta.seqNo,
          "value": {
            "accum": entry_from.idata.expansion.idata.txn.data.value.accum
          }
        }
      }

      const result = {
        op: "REPLY",
        result: {
          type: "117",
          identifier,
          reqId,
          revocRegDefId,
          seqNo: entry_to.imeta.seqNo,
          txnTime: entry_to_originalTx.txnMetadata.txnTime,
          data: {
            "revocDefType": entry_to.idata.expansion.idata.txn.data.revocDefType, 
            "revocRegDefId": entry_to.idata.expansion.idata.txn.data.revocRegDefId,
            value,
            stateProofFrom: entry_from && {}
          },
          state_proof: {}
        },
      }

      res.status(200).send(result)

  }))

  //GET_TRANSACTION_AUTHOR_AGREEMENT_AML
  app.get('/api/networks/:networkRef/txs/taaa/',
    validate(
      {
        query: Joi.object({
          timestamp: Joi.string(),
          version: Joi.string(),
          reqId: Joi.string().required(),
          identifier: Joi.string().required()
        })
      }
    ),
    asyncHandler(async function (req, res, next) {
      const networkId = getNetworkId(req, res)
      const { version, timestamp,  reqId, identifier } = req.query
      
      if (timestamp && version) {
        next(new ValidationError("'timestamp' is mutually exclusive with 'version'"))
      }
      else {
        const txs = await serviceTxs.getTxByType(networkId, 'config', {version, timestamp}, "TXN_AUTHOR_AGREEMENT_AML")

        let originalTx = JSON.parse(txs[0].idata.serialized.idata.json)

        const result = {
          op: "REPLY",
          result: {
            data: originalTx.txn.data,
            type: "7",
            identifier,
            reqId,
            version: originalTx.txn.data.version,
            seqNo: txs[0].imeta.seqNo,
            txnTime: originalTx.txnMetadata.txnTime,
            state_proof: {}
          }
        }

        res.status(200).send(result)
      }

  }))

    //GET_TRANSACTION_AUTHOR_AGREEMENT
    app.get('/api/networks/:networkRef/txs/txaa/',
      validate(
        {
          query: Joi.object({
            digest: Joi.string(),
            timestamp: Joi.string(),
            version: Joi.string(),
            reqId: Joi.string().required(),
            identifier: Joi.string().required()
          })
        }
      ),
      asyncHandler(async function (req, res, next) {
        const networkId = getNetworkId(req, res)
        const { version, timestamp, digest, reqId, identifier } = req.query
        
        if ((version && timestamp) || (version && digest) || (timestamp && digest)) {
          next(new ValidationError("query paramters 'timestamp', 'version' and 'digest' are mutually exclusive"))
        }
        else {
          const txs = await serviceTxs.getTxByType(networkId, 'config', {version, digest, timestamp}, "TXN_AUTHOR_AGREEMENT")
  
          let originalTx = JSON.parse(txs[0].idata.serialized.idata.json)
  
          const result = {
            op: "REPLY",
            result: {
              data: originalTx.txn.data,
              type: "6",
              identifier,
              reqId,
              version: originalTx.txn.data.version,
              seqNo: txs[0].imeta.seqNo,
              txnTime: originalTx.txnMetadata.txnTime,
              state_proof: {}
            }
          }
  
          res.status(200).send(result)
        }
  
    }))

    //GET_AUTH_RULE
    app.get('/api/networks/:networkRef/txs/auth-rule/',
      validate(
        {
          query: Joi.object({
            auth_action: Joi.string(),
            auth_type: Joi.string(),
            field: Joi.string(),
            old_value: Joi.string(),
            new_value: Joi.string(),
            reqId: Joi.string().required(),
            identifier: Joi.string().required()
          })
        }
      ),
      asyncHandler(async function (req, res, next) {
        const networkId = getNetworkId(req, res)
        const {
          auth_action,
          auth_type,
          field,
          old_value,
          new_value,
          reqId,
          identifier
        } = req.query
        
        const inclusive_params = [
          auth_action,
          auth_type,
          field,
          new_value
        ].filter(param => typeof param !== 'undefined');

        // If any of the query params is defined, all must be defined.
        // `old_value` is optional
        if (inclusive_params.length > 0 && inclusive_params.length !== 4) {
          next(
            {
              message: '`auth_action`, `auth_type`, `field`,`new_value` '+
              'query params must be defined if any one of them is defined.'});
        }
        else {
          const txs = await serviceTxs.getTxByType(
            networkId,
            'config',
            {
              auth_action,
              auth_type,
              field,
              old_value,
              new_value,
              reqId,
              identifier
            },
            "AUTH_RULE"
          )

          const result = {
            op: "REPLY",
            result: {
              data: txs.map(
                (tx) => {
                  return tx.idata.expansion.idata.txn.data
                }
              ),
              type: "121",
              identifier,
              reqId,
              auth_type,
              auth_action,
              field,
              old_value,
              new_value,
              state_proof: {}
            }
          }

          res.status(200).send(result)
        }
    }))

  app.get('/api/networks/:networkRef/ledgers/:ledger/txs/stats/count',
    validate(
      {
        query: Joi.object({
          filterTxNames: Joi.array().items(Joi.string())
        })
      }
    ),
    asyncHandler(async function (req, res) {
      const { ledger } = req.params
      const networkId = getNetworkId(req, res)
      const { filterTxNames, search } = req.query
      const txCount = await serviceTxs.getTxsCount(networkId, ledger, filterTxNames, search)
      res.status(200).send({ txCount })
    }))

  return app
}

module.exports = initTxsApi
