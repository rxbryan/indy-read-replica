/* eslint-env jest */
const indy = require('vdr-tools')
const { isUnknownLedger, registerLedger } = require('../../src/indy/indyclient')
const path = require('path')

describe('basic indy pool operations', () => {
  it('should be unknown ledger', async () => {
    const isRecognized = await isUnknownLedger('foobarfoobarfoobarfoobarfoobar123')
    expect(isRecognized).toBeTruthy()
  })

  it('should create ledger if doesnt exist', async () => {
    try {
      await indy.deletePoolLedgerConfig('abcdabcdabcd4bcdabcdabcd4bcdabcd')
    } catch (e) {}
    const isRecognized = await isUnknownLedger('abcdabcdabcd4bcdabcdabcd4bcdabcd')
    expect(isRecognized).toBeTruthy()
    const RESOURCE_DIR = path.resolve(__dirname, '../resource')
    const isRecognized2 = await registerLedger('abcdabcdabcd4bcdabcdabcd4bcdabcd', `${RESOURCE_DIR}/pool_transactions_builder_genesis`)
    expect(isRecognized2).toBeFalsy()
    try {
      await indy.deletePoolLedgerConfig('abcdabcdabcd4bcdabcdabcd4bcdabcd')
    } catch (e) {}
  })
})
