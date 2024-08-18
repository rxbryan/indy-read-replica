/* eslint-env jest */
const { createTransformerOriginal2Serialized } = require('../../../src/transformers/transformer-original2serialized')

const processor = createTransformerOriginal2Serialized({})

describe('original to serializer transformation', () => {
  it('should not modify any data that comes in and return copy of it', async () => {
    const tx = { foo: 'bar', baz: 'baz' }
    const { processedTx, format } = await processor.processTx(tx)
    expect(format).toBe('serialized')
    expect(JSON.stringify(processedTx)).toBe(JSON.stringify({ json: JSON.stringify(tx) }))
    expect(tx === processedTx).toBeFalsy()
  })
})
